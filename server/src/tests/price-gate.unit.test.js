// specs/pricing-components.md §3 rules 68 and 70 — the price non-regression gate. Every reservation and devis of the
// anonymised production copy (`fixtures/price-gate/inputs.json`) is loaded into a freshly migrated database, the
// clock is frozen on the capture day, every stay is recomputed through the CURRENT code path (quote of the stored
// stay, fiche, cancellation preview, installments, platform payment figures) and compared, to the cent, with the
// figures captured on the baseline code (`expected.json`), at the four instants of `recompute.js` (the capture day and
// three moments of the stay's own life: the date-dependent figures are judged, not only the ones of one day), exactly —
// no rounding. The standalone resource bookings are compared too. Any difference fails; the only exception is a line of the
// versioned `allowlist.json`. Without the fixture files the gate skips and says why.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const { mock } = test;
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
let recomputedBookings = null;
let recomputedGrids = null;
let expected = null;
if (captured) {
  const inputs = read('inputs.json');
  expected = read('expected.json');
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs, recomputeStays, recomputeResourceBookings, recomputePropertyGrids } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, inputs);
  const at = new Date(inputs.meta.capturedAt).getTime();
  mock.timers.enable({ apis: ['Date'], now: at });
  const pinClock = (instant) => { mock.timers.setTime(new Date(instant).getTime()); return () => mock.timers.setTime(at); };
  recomputed = recomputeStays(db, { capturedAt: inputs.meta.capturedAt, pinClock });
  recomputedBookings = recomputeResourceBookings(db);
  recomputedGrids = recomputePropertyGrids(db);
  mock.timers.reset();
}

test('rule 68: no price moved on any stay or devis of the production copy', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.stays, recomputed, allowlist);
  const shown = differences.slice(0, 40).map((d) => `  stay ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved on stay(s) ${[...new Set(differences.map((d) => d.reservationId))].join(', ')}\n${shown.join('\n')}`);
});

test('rule 68: no figure of a standalone resource booking moved', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.resourceBookings, recomputedBookings, allowlist, { scope: 'resourceBookings' });
  const shown = differences.slice(0, 40).map((d) => `  booking ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved\n${shown.join('\n')}`);
  assert.ok(Object.keys(expected.resourceBookings).length > 0, 'the fixture holds resource bookings');
});

test('rule 70: no figure of the platform price grid of a property moved', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.propertyGrids, recomputedGrids, allowlist, { scope: 'propertyGrids' });
  const shown = differences.slice(0, 40).map((d) => `  property ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved\n${shown.join('\n')}`);
  assert.ok(Object.keys(expected.propertyGrids).length > 0, 'the fixture holds property grids');
});

test('rule 68: every allowlist entry still matches a difference (a stale entry is removed)', { skip: SKIP }, () => {
  const { unusedEntries } = compareFigures(expected.stays, recomputed, allowlist);
  assert.deepEqual(unusedEntries, []);
  const bookings = compareFigures(expected.resourceBookings, recomputedBookings, allowlist, { scope: 'resourceBookings' });
  assert.deepEqual(bookings.unusedEntries, []);
  const grids = compareFigures(expected.propertyGrids, recomputedGrids, allowlist, { scope: 'propertyGrids' });
  assert.deepEqual(grids.unusedEntries, []);
});

test('rule 70: the platform stays carry their commission, net received and payout figures', { skip: SKIP }, () => {
  const platform = Object.values(expected.stays).filter((s) => s['platform.sale@capture'] === true);
  assert.ok(platform.length > 0, 'the fixture holds platform stays');
  for (const key of ['platform.commission.solde', 'platform.commission.total', 'platform.netReceived', 'input.platform.payout']) {
    assert.ok(platform.every((s) => `${key}@capture` in s), `${key} is captured for every platform stay`);
  }
});

test('rule 68: every stay is read at the capture day and at three moments of its own life, and a date moves a figure', { skip: SKIP }, () => {
  const instants = ['capture', 'arrival-1459', 'arrival-1500', 'after'];
  for (const [id, figures] of Object.entries(expected.stays)) {
    for (const instant of instants) assert.ok(`kind@${instant}` in figures, `stay ${id} is read at ${instant}`);
  }
  const moved = Object.values(expected.stays).filter((figures) => Object.keys(figures).some((key) => {
    const [name, instant] = key.split('@');
    return instant === 'capture' && instants.slice(1).some((other) => `${name}@${other}` in figures && figures[`${name}@${other}`] !== figures[key]);
  }));
  assert.ok(moved.length > 0, 'no figure of any stay depends on the date: the gate would not see a clock-dependent regression');
});

test('rule 68: the fixture holds stays and devis and recomputes every one of them', { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(recomputed), Object.keys(expected.stays));
  const kinds = new Set(Object.values(expected.stays).map((s) => s['kind@capture']));
  assert.ok(kinds.has('reservation') && kinds.has('devis'));
});
