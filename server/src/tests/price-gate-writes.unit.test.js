// specs/pricing-components.md §3 rule 81 (decision D9) — the refund WRITE paths of the price gate. The cases of
// `scripts/price-gate/writeReplay.js` (refund create and its refusals, deletion, the cancellation's avoir and nettings,
// un-tick with a refund standing, the D25 pool, an end-of-stay refund, a refund from the trop-perçu) are played through
// the real controllers on an empty database with the clock frozen on the capture day, and compared, exactly, with what
// the `price-gate-baseline` code wrote (`fixtures/price-gate/writes.json`, captured once by `buildWriteReplay.mjs`).
// A behaviour PR B changes on purpose is an `allowlist.json` entry of scope `writes`, never a recapture.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareFigures } = require('./helpers/priceGateCompare');

const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'price-gate', 'allowlist.json'), 'utf8'));

const FILE = path.join(process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate'), 'writes.json');
const present = fs.existsSync(FILE);
const SKIP = present ? false : 'writes.json absent (captured on the price-gate-baseline tag: node scripts/price-gate/buildWriteReplay.mjs --out <writes.json>)';

let expected = null;
let played = null;
test.before(async () => {
  if (!present) return;
  expected = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(expected.meta.capturedAt));
  played = await require('../../../scripts/price-gate/writeReplay').playWrites();
});

test('rule 81: the replay plays the seven write-path cases the fixture holds', { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(played), Object.keys(expected.cases));
  assert.equal(Object.keys(expected.cases).length, 7);
});

// Every leaf of a case, as `{ 'steps[2].body.code': 'REFUND_EXCEEDS_LINE_COLLECTED', ... }`, so an allowlist entry names ONE figure.
function leaves(value, prefix, out) {
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [`[${i}]`, v]) : Object.entries(value).map(([k, v]) => [`.${k}`, v]);
    if (!entries.length) out[prefix] = Array.isArray(value) ? [] : {};
    for (const [suffix, v] of entries) leaves(v, `${prefix}${suffix}`, out);
  } else {
    out[prefix] = value;
  }
  return out;
}
// Keyed by the stay the case played on (an allowlist entry names a stay id), each figure prefixed by its case.
const figuresOf = (cases) => Object.fromEntries(Object.entries(cases).map(([name, played]) => [played.stayId, leaves(played, name, {})]));

test('rule 81: every step and every row of every write-path case is what the baseline code wrote, to the leaf', { skip: SKIP }, () => {
  const { differences } = compareFigures(figuresOf(expected.cases), figuresOf(played), allowlist, { scope: 'writes' });
  const shown = differences.slice(0, 30).map((d) => `  ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} leaf(s) moved\n${shown.join('\n')}`);
});

test('rule 81: every writes allowlist entry still matches a difference', { skip: SKIP }, () => {
  assert.deepEqual(compareFigures(figuresOf(expected.cases), figuresOf(played), allowlist, { scope: 'writes' }).unusedEntries, []);
});
