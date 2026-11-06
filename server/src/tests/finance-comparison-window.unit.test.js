const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-revpar-year-over-year.md §3 rules 4, 5, 6, 7, 9 and 10 — the comparable range of a
// window, its one reason and its one notice, and each figure's comparison. Pure: today is passed in.
// The clock is pinned for the whole file (the server test-isolation spec: no literal date the calendar
// will pass), on the day these figures were written against.
require('node:test').mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 11) });
const { comparisonWindow, compare, pointsChange, firstDayAfter } = require('../utils/financeComparison');
const yoy = require('../utils/yearOverYear');

const FY = { from: '2026-01-01', to: '2026-12-31' };

test('rule 4 — the range is the dashboard\'s own: comparableRange, clamped to the months over without the snapshot', () => {
  const known = comparisonWindow({ window: FY, coverage: '2025-01', today: '2026-10-18', trackingStart: '2025-01-05' });
  assert.equal(known.snapshotKnown, true);
  assert.deepEqual(known.range, yoy.comparableRange(FY, '2025-01'));
  assert.equal(known.knownAt, '2025-10-18');
  const unknown = comparisonWindow({ window: FY, coverage: '2025-01', today: '2026-10-18', trackingStart: '2026-04-10' });
  assert.deepEqual(unknown.range, yoy.clampToMonthsOver(yoy.comparableRange(FY, '2025-01'), '2026-10-18'));
  assert.equal(unknown.status.comparable, true);
  assert.equal(unknown.status.months, 9);
  assert.match(unknown.status.notice, /^Comparé à l'an dernier sur 9 mois sur 12 : un mois en cours se compare une fois terminé\.$/);
});

test('rule 5 — no data a year back: reason noHistory, one notice naming where the data starts', () => {
  const s = comparisonWindow({ window: FY, coverage: '2026-04', today: '2026-10-18', trackingStart: '2026-04-10' }).status;
  assert.equal(s.comparable, false);
  assert.equal(s.reason, 'noHistory');
  assert.equal(s.notice, "Pas de comparaison avec l'an dernier : les données commencent en avril 2026.");
  const empty = comparisonWindow({ window: FY, coverage: null, today: '2026-10-18', trackingStart: null }).status;
  assert.equal(empty.reason, 'noHistory');
  assert.equal(empty.notice, "Pas de comparaison avec l'an dernier : aucun séjour enregistré.");
});

test('rule 6 — not known yet: the first day a part compares, the month over or a year of booking dates', () => {
  const month = { from: '2026-10-01', to: '2026-10-31' };
  const byMonthEnd = comparisonWindow({ window: month, coverage: '2025-01', today: '2026-10-18', trackingStart: '2026-04-10' }).status;
  assert.equal(byMonthEnd.reason, 'notYetKnown');
  assert.equal(byMonthEnd.comparableFrom, '2026-11-01');
  assert.equal(byMonthEnd.notice, "Comparaison avec l'an dernier une fois le premier mois terminé, à partir du 1er novembre 2026.");
  // The pace's comparableFrom (tracking start + 1 year) comes first.
  const bySnapshot = comparisonWindow({ window: month, coverage: '2025-01', today: '2026-10-18', trackingStart: '2025-10-25' }).status;
  assert.equal(bySnapshot.reason, 'notYetKnown');
  assert.equal(bySnapshot.comparableFrom, '2026-10-25');
  // December rolls to January.
  assert.equal(firstDayAfter('2026-12'), '2027-01-01');
});

test('rule 7 — partial on coverage: the notice says how many months, and why', () => {
  const s = comparisonWindow({ window: FY, coverage: '2025-05', today: '2027-06-01', trackingStart: '2025-05-02' }).status;
  assert.equal(s.comparable, true);
  assert.equal(s.complete, false);
  assert.equal(s.months, 8);
  assert.deepEqual(s.current, { from: '2026-05-01', to: '2026-12-31' });
  assert.deepEqual(s.previous, { from: '2025-05-01', to: '2025-12-31' });
  assert.equal(s.notice, "Comparé à l'an dernier sur 8 mois sur 12 : les données commencent en mai 2025.");
  const whole = comparisonWindow({ window: FY, coverage: '2024-01', today: '2027-06-01', trackingStart: '2024-01-02' }).status;
  assert.equal(whole.complete, true);
  assert.equal(whole.notice, null);
});

test('rule 4 — leap year: 29 February compares with 28 February', () => {
  const s = comparisonWindow({ window: { from: '2028-02-01', to: '2028-02-29' }, coverage: '2026-01', today: '2028-06-01', trackingStart: '2026-01-02' }).status;
  assert.deepEqual(s.previous, { from: '2027-02-01', to: '2027-02-28' });
  const back = comparisonWindow({ window: { from: '2029-02-01', to: '2029-02-28' }, coverage: '2026-01', today: '2029-06-01', trackingStart: '2026-01-02' }).status;
  assert.deepEqual(back.previous, { from: '2028-02-01', to: '2028-02-28' });
});

const OK = { comparable: true, reason: null };

test('rule 9 — money and counts compare in percent, one decimal, the dashboard\'s yearOverYear.change', () => {
  assert.deepEqual(compare(1400, 1000, 'percent', OK), { current: 1400, previous: 1000, change: 40, unit: 'percent', comparable: true, reason: null });
  assert.equal(compare(107.69, 100, 'percent', OK).change, 7.7);
  assert.equal(compare(0, 500, 'percent', OK).change, -100);
  assert.equal(compare(15, 15, 'percent', OK).change, 0);
});

test('rule 9 — a rate compares in points, one decimal, half away from zero, never −0', () => {
  assert.deepEqual(compare(0.037, 0.0251, 'points', OK), { current: 0.037, previous: 0.0251, change: 1.2, unit: 'points', comparable: true, reason: null });
  assert.equal(pointsChange(0.4215, 0.42), 0.2);
  assert.equal(pointsChange(0.42, 0.4215), -0.2);
  assert.equal(Object.is(pointsChange(0.4201, 0.42), 0), true);
  assert.equal(pointsChange(0.3, 0), 30);
  assert.equal(compare(0.3, 0, 'points', OK).comparable, true, 'a rate of 0 % last year is a base');
});

test('rule 10 — no base last year, or no value this year: not comparable, one reason, never +∞', () => {
  assert.deepEqual(compare(500, 0, 'percent', OK), { current: 500, previous: 0, change: null, unit: 'percent', comparable: false, reason: 'noPreviousValue' });
  assert.equal(compare(0.2, null, 'points', OK).reason, 'noPreviousValue');
  assert.equal(compare(null, 100, 'percent', OK).reason, 'noCurrentValue');
  const off = compare(null, null, 'points', { comparable: false, reason: 'notYetKnown' });
  assert.deepEqual(off, { current: null, previous: null, change: null, unit: 'points', comparable: false, reason: 'notYetKnown' });
});
