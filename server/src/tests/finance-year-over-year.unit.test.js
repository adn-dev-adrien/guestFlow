const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 17-21 — comparison with last year, month by month: a month
// is comparable once the same month a year earlier is covered; a window compares its comparable part.
const { coverageMonth, isComparableMonth, comparableRange, change, shiftYear } = require('../utils/yearOverYear');

test('rule 17 — the coverage starts with the month of the earliest reservation', () => {
  assert.equal(coverageMonth('2026-04-12'), '2026-04');
  assert.equal(coverageMonth(null), null);
});

test('rule 18 — a month is comparable once the same month last year is covered', () => {
  assert.equal(isComparableMonth('2027-03', '2026-04'), false);
  assert.equal(isComparableMonth('2027-04', '2026-04'), true);
  assert.equal(isComparableMonth('2027-04', null), false);
});

test('rule 20 — a fully covered window compares with its twin a year earlier', () => {
  const r = comparableRange({ from: '2026-01-01', to: '2026-12-31' }, '2024-01');
  assert.deepEqual(r, { current: { from: '2026-01-01', to: '2026-12-31' }, previous: { from: '2025-01-01', to: '2025-12-31' }, months: 12, totalMonths: 12, complete: true });
});

test('rule 20 — a partly covered window compares its comparable months only, and says how many', () => {
  const r = comparableRange({ from: '2026-01-01', to: '2026-12-31' }, '2025-04');
  assert.deepEqual(r, { current: { from: '2026-04-01', to: '2026-12-31' }, previous: { from: '2025-04-01', to: '2025-12-31' }, months: 9, totalMonths: 12, complete: false });
});

test('rule 20 — no comparable month, no comparison (a custom window included)', () => {
  assert.equal(comparableRange({ from: '2026-01-01', to: '2026-12-31' }, '2026-04'), null);
  assert.equal(comparableRange({ from: '2026-07-10', to: '2026-08-20' }, null), null);
  assert.equal(comparableRange({ from: '2026-07-10', to: '2026-08-20' }, '2025-07').months, 2);
});

test('rule 20 — the change is in percent, one decimal, null without a base', () => {
  assert.equal(change(110, 100), 10);
  assert.equal(change(90, 120), -25);
  assert.equal(change(50, 0), null);
  assert.equal(shiftYear('2028-02-29', -1), '2027-02-28');
});
