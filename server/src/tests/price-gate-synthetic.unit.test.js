// specs/pricing-components.md §3 rules 68 and 72 (PR A bullet) — the price gate's synthetic refund stays. The snapshot
// holds one refund, so the refund cases the suites pin (cancelled with indemnity, caisse interne, mixed methods,
// installments, line refund, trop-perçu) were played once through the real controllers on the baseline code
// (`scripts/price-gate/buildSynthetic.js`); their anonymised rows are loaded into a fresh database here and every
// figure of the refund side (refundable lines, collected TTC, stored and live trop-perçu, cancellation preview,
// refund journal rows) is recomputed through the CURRENT code and compared, to the cent, with the captured one.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareFigures } = require('./helpers/priceGateCompare');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const captured = ['inputs.json', 'expected.json'].every((name) => fs.existsSync(path.join(DIR, name)));
const present = captured && read('inputs.json').synthetic && read('expected.json').synthetic;
const SKIP = present ? false : 'price-gate synthetic section absent (captured on the price-gate-baseline tag: node scripts/price-gate/buildFixture.mjs)';

let recomputed = null;
let expected = null;
if (present) {
  const inputs = read('inputs.json');
  expected = read('expected.json').synthetic;
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs, recomputeStays } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, { tables: inputs.synthetic.tables });
  recomputed = recomputeStays(db);
}

test('rule 72: no refund figure moved on any synthetic stay', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.stays, recomputed, []);
  const shown = differences.slice(0, 40).map((d) => `  stay ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved\n${shown.join('\n')}`);
});

test('rule 72: the synthetic stays cover the refund cases and every one carries its refund figures', { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(recomputed), Object.keys(expected.stays));
  const stays = Object.entries(expected.cases).map(([name, id]) => [name, expected.stays[id]]);
  assert.ok(stays.length >= 8, 'the cases of the refund suites');
  for (const [name, figures] of stays) {
    assert.ok('refund.collected' in figures, `${name}: collected TTC`);
    assert.ok('overpayment.stored.ttc' in figures || figures.kind === 'cancelled', `${name}: stored trop-perçu`);
    assert.ok('cancel.refusal' in figures, `${name}: cancellation preview`);
  }
  const journalled = stays.filter(([, f]) => Object.keys(f).some((k) => k.startsWith('refund.journal.')));
  assert.ok(journalled.length >= 4, 'refund journal rows are captured');
  assert.ok(stays.some(([, f]) => f.kind === 'cancelled'), 'a cancelled stay');
  assert.ok(stays.some(([, f]) => Object.keys(f).some((k) => /^installment\.\d+\.paid$/.test(k))), 'an installment plan');
});
