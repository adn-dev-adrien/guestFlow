// specs/pricing-components.md §3 rules 68, 72 and 81 (PR A bullet) — the price gate's synthetic stays. The snapshot
// holds one refund and no example of several money paths, so the refund cases the suites pin (cancelled with indemnity,
// caisse interne, mixed methods, installments, line refund, trop-perçu) and one named case for every other money path
// (7.77 % discount, progressive option fresh and sold, insurance on the stay and per night, typed counts, mid-stay notes
// settled in cash and on the books, arrival reduction and tip, platform penalty, complement paid in a split, live
// installment plan, commissions withheld on a live own-channel stay, standalone and attached hourly bookings) were played
// once through the real controllers on the baseline code (`scripts/price-gate/buildSynthetic.js`); their anonymised rows
// are loaded into a fresh database here and every figure (each read at the four instants of `recompute.js`) is recomputed
// through the CURRENT code and compared, exactly, with the captured one.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareFigures } = require('./helpers/priceGateCompare');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'price-gate', 'allowlist.json'), 'utf8'));
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const captured = ['inputs.json', 'expected.json'].every((name) => fs.existsSync(path.join(DIR, name)));
const present = captured && read('inputs.json').synthetic && read('expected.json').synthetic;
const SKIP = present ? false : 'price-gate synthetic section absent (captured on the price-gate-baseline tag: node scripts/price-gate/buildFixture.mjs)';

let recomputed = null;
let recomputedBookings = null;
let recomputedGrids = null;
let expected = null;
if (present) {
  const inputs = read('inputs.json');
  expected = read('expected.json').synthetic;
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs, recomputeStays, recomputeResourceBookings, recomputePropertyGrids } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, { tables: inputs.synthetic.tables });
  const at = new Date(inputs.meta.capturedAt).getTime();
  mock.timers.enable({ apis: ['Date'], now: at });
  const pinClock = (instant) => { mock.timers.setTime(new Date(instant).getTime()); return () => mock.timers.setTime(at); };
  recomputed = recomputeStays(db, { capturedAt: inputs.meta.capturedAt, pinClock });
  recomputedBookings = recomputeResourceBookings(db);
  recomputedGrids = recomputePropertyGrids(db);
  mock.timers.reset();
}

test('rule 68: no figure of a synthetic resource booking moved', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.resourceBookings, recomputedBookings, allowlist, { scope: 'synthetic' });
  const shown = differences.slice(0, 40).map((d) => `  booking ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved\n${shown.join('\n')}`);
});

test('rule 70: no figure of the platform price grid of a synthetic property moved (commissions of 15 and 15.5 %)', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.propertyGrids, recomputedGrids, allowlist, { scope: 'synthetic' });
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved`);
  assert.ok(Object.values(expected.propertyGrids).some((g) => Object.keys(g).length > 10), 'the grids hold prices');
});

test('rule 72: no refund figure moved on any synthetic stay', { skip: SKIP }, () => {
  const { differences } = compareFigures(expected.stays, recomputed, allowlist, { scope: 'synthetic' });
  const shown = differences.slice(0, 40).map((d) => `  stay ${d.reservationId} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  assert.equal(differences.length, 0, `${differences.length} figure(s) moved\n${shown.join('\n')}`);
});

test('rule 72: the synthetic stays cover the refund cases and every one carries its refund figures', { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(recomputed), Object.keys(expected.stays));
  const stays = Object.entries(expected.cases).map(([name, id]) => [name, expected.stays[id]]);
  assert.ok(stays.length >= 8, 'the cases of the refund suites');
  for (const [name, figures] of stays) {
    assert.ok('refund.collected@capture' in figures, `${name}: collected TTC`);
    assert.ok('overpayment.stored.ttc@capture' in figures || figures['kind@capture'] === 'cancelled', `${name}: stored trop-perçu`);
    assert.ok('cancel.refusal@capture' in figures, `${name}: cancellation preview`);
  }
  const journalled = stays.filter(([, f]) => Object.keys(f).some((k) => k.startsWith('refund.journal.')));
  assert.ok(journalled.length >= 4, 'refund journal rows are captured');
  assert.ok(stays.some(([, f]) => f['kind@capture'] === 'cancelled'), 'a cancelled stay');
  assert.ok(stays.some(([, f]) => Object.keys(f).some((k) => /^installment\.\d+\.paid@capture$/.test(k))), 'an installment plan');
});

// Each money path the production snapshot has no example of, and the figure that proves the case really exercises it.
const PATHS = {
  'discount-7.77pct': ['discount.percent@capture', 7.77],
  'progressive-option-fresh': ['line.option:108.total@capture'],
  'progressive-option-sold': ['line.option:101.total@capture'],
  'percent-of-stay-insurance': ['line.option:102.total@capture'],
  'per-night-insurance-priced': ['line.option:103.unitPrice@capture'],
  'typed-counts-options': ['line.option:104.billedUnits@capture', 3],
  'mid-stay-notes-settled-cash': ['status.remainingDue@capture'],
  'mid-stay-notes-settled-book': ['status.remainingDue@capture'],
  'arrival-reduction-and-tip': ['total.net@capture'],
  'platform-penalty': ['input.platform.penalty@capture', 23.45],
  'complement-paid-split': ['paid.complementPaid@capture', true],
  'installments-live': ['installment.1.paid@capture', true],
  'own-channel-commissions-live': ['cancel.withheld.total@capture'],
  'stay-with-hourly-booking': ['kind@capture', 'reservation'],
};

test('rule 68: the fixture holds one named synthetic stay for every money path the snapshot has no example of', { skip: SKIP }, () => {
  for (const [name, [figure, value]] of Object.entries(PATHS)) {
    assert.ok(name in expected.cases, `case ${name}`);
    const figures = expected.stays[expected.cases[name]];
    assert.ok(figure in figures, `${name}: ${figure} is captured`);
    if (value !== undefined) assert.equal(figures[figure], value, `${name}: ${figure}`);
  }
});

test('rule 68: the synthetic cases carry the money they are named for (not a path that silently priced nothing)', { skip: SKIP }, () => {
  const figure = (name, key) => expected.stays[expected.cases[name]][key];
  assert.ok(figure('progressive-option-fresh', 'line.option:108.total@capture') > 0);
  assert.ok(figure('percent-of-stay-insurance', 'line.option:102.total@capture') > 0);
  assert.ok(figure('per-night-insurance-priced', 'line.option:103.total@capture') > 0);
  assert.ok(figure('mid-stay-notes-settled-cash', 'schedule.endOfStayComplement@capture') !== undefined);
  assert.ok(figure('own-channel-commissions-live', 'cancel.withheld.total@capture') > 0, 'a live stay whose cancellation reverses withheld commissions');
  assert.ok(figure('arrival-reduction-and-tip', 'total.net@capture') !== figure('arrival-reduction-and-tip', 'total.final@capture'), 'the reduction and the tip move the net total');
  const books = Object.values(expected.resourceBookings);
  assert.ok(books.some((b) => b['stored.paid'] === true && b['breakdown.vat.rate'] === 20 && b['sale.booksCents'] > 0), 'a standalone booking paid, VAT 20 %');
  assert.ok(books.some((b) => b.reservationId !== null && b['breakdown.freeMinutesApplied'] > 0), 'a booking attached to a stay');
  assert.ok(books.some((b) => b['breakdown.offeredMinutesApplied'] > 0), 'a booking with offered time');
  assert.deepEqual(Object.keys(expected.resourceBookings), Object.keys(recomputedBookings));
});

test('rule 68: a mid-stay note is settled in the caisse in one case and on the books in the other', { skip: SKIP }, () => {
  const { tables } = read('inputs.json').synthetic;
  const notes = (name) => JSON.parse(tables.reservations.find((r) => r.id === expected.cases[name]).midStaySettledNotes);
  assert.ok(notes('mid-stay-notes-settled-cash').every((n) => Number(n.paidCash) === 1));
  assert.ok(notes('mid-stay-notes-settled-book').every((n) => Number(n.paidCash || 0) === 0));
  assert.ok(notes('mid-stay-notes-settled-cash').every((n) => (n.items || []).every((i) => /^Line \d+$/.test(i.label || 'Line 1'))), 'labels are placeholders');
});

test('rule 81: every synthetic allowlist entry still matches a difference of one of the three synthetic families', { skip: SKIP }, () => {
  const unusedIn = (expectedSet, actualSet) => compareFigures(expectedSet, actualSet, allowlist, { scope: 'synthetic' }).unusedEntries;
  const stale = unusedIn(expected.stays, recomputed)
    .filter((entry) => unusedIn(expected.resourceBookings, recomputedBookings).includes(entry))
    .filter((entry) => unusedIn(expected.propertyGrids, recomputedGrids).includes(entry));
  assert.deepEqual(stale, []);
});
