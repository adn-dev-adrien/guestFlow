// specs/pricing-components.md §3 rules 68 and 70 — the price non-regression gate. Every reservation and devis of the
// anonymised production copy (`fixtures/price-gate/inputs.json`) is loaded into a freshly migrated database, the
// clock is frozen on the capture day, every stay is recomputed through the CURRENT code path (quote of the stored
// stay, fiche, cancellation preview, installments, platform payment figures) and compared, to the cent, with the
// figures captured on the baseline code (`expected.json`). Any difference fails; the only exception is a line of the
// versioned `allowlist.json`. Without the fixture files the gate skips and says why.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareFigures, allowlistProblems } = require('./helpers/priceGateCompare');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const captured = ['inputs.json', 'expected.json'].every((name) => fs.existsSync(path.join(DIR, name)));
const SKIP = captured ? false : 'price-gate fixture absent (inputs.json / expected.json are captured on the price-gate-baseline tag: node scripts/price-gate/buildFixture.mjs <copy.db> --out server/src/tests/fixtures/price-gate/)';

const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'price-gate', 'allowlist.json'), 'utf8'));

test('rule 68: the allowlist is a complete array of one-field entries', () => {
  assert.deepEqual(allowlistProblems(allowlist), []);
});

let recomputed = null;
let expected = null;
if (captured) {
  const inputs = read('inputs.json');
  expected = read('expected.json');
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs, recomputeStays } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, inputs);
  recomputed = recomputeStays(db);
}

test('rule 68: no price moved on any stay or devis of the production copy', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.stays, recomputed, allowlist);
  const shown = differences.slice(0, 40).map((d) => `  stay ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved on stay(s) ${[...new Set(differences.map((d) => d.reservationId))].join(', ')}\n${shown.join('\n')}`);
});

test('rule 68: every allowlist entry still matches a difference (a stale entry is removed)', { skip: SKIP }, () => {
  const { unusedEntries } = compareFigures(expected.stays, recomputed, allowlist);
  assert.deepEqual(unusedEntries, []);
});

test('rule 70: the platform stays carry their commission, net received and withheld-commission figures', { skip: SKIP }, () => {
  const platform = Object.values(expected.stays).filter((s) => s['platform.sale'] === true);
  assert.ok(platform.length > 0, 'the fixture holds platform stays');
  for (const key of ['platform.commission.solde', 'platform.commission.total', 'platform.netReceived', 'platform.payout', 'cancel.withheld.solde']) {
    assert.ok(platform.every((s) => key in s), `${key} is captured for every platform stay`);
  }
});

test('rule 68: the fixture holds stays and devis and recomputes every one of them', { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(recomputed), Object.keys(expected.stays));
  const kinds = new Set(Object.values(expected.stays).map((s) => s.kind));
  assert.ok(kinds.has('reservation') && kinds.has('devis'));
});
