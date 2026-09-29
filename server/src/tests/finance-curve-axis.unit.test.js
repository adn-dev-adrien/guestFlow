const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 30 — the cumulative curve's graduations sit on the calendar
// (1st of each month, or the 1st/8th/15th/22nd/29th on a short window), never on the sampled points.
const { curveAxis, dayOffset } = require('../utils/financeCurveAxis');

test('rule 30 — an exercise gets one graduation per month, on the 1st', () => {
  const ticks = curveAxis('2025-10-01', '2026-09-30', false);
  assert.deepEqual(ticks.map((t) => t.label), ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.']);
  assert.deepEqual(ticks.slice(0, 4).map((t) => t.x), [0, 31, 61, 92]);
  assert.equal(ticks.at(-1).x, dayOffset('2025-10-01', '2026-09-01'));
});

test('rule 30 — a month gets a graduation every week, from the 1st', () => {
  assert.deepEqual(curveAxis('2026-02-01', '2026-02-28', true), [
    { x: 0, label: '1 févr.' }, { x: 7, label: '8 févr.' }, { x: 14, label: '15 févr.' }, { x: 21, label: '22 févr.' },
  ]);
  assert.equal(curveAxis('2026-08-01', '2026-08-31', true).at(-1).label, '29 août');
});

test('rule 30 — a custom window starting mid-month skips the month it starts in', () => {
  assert.deepEqual(curveAxis('2026-06-10', '2026-09-20', false).map((t) => t.label), ['juil.', 'août', 'sept.']);
  assert.deepEqual(curveAxis('2026-06-10', '2026-07-05', true).map((t) => t.label), ['15 juin', '22 juin', '29 juin', '1 juil.']);
});

test('rule 30 — January is named by its year once a month could appear twice', () => {
  const long = curveAxis('2025-01-01', '2026-06-30', false).map((t) => t.label);
  assert.equal(long[0], '2025');
  assert.equal(long[12], '2026');
  assert.equal(curveAxis('2027-10-01', '2028-09-30', false)[3].label, 'janv.');
});

test('rule 30 — the dashboard places every point and graduation on the same day scale', () => {
  const { freshDb, insert, THIS_YEAR } = require('./financeDashboardFixture');
  const { db, dashboard } = freshDb();
  const Y = THIS_YEAR - 1;
  insert(db, { startDate: `${Y}-07-01`, endDate: `${Y}-07-05`, balanceAmount: 500, createdAt: `${Y - 1}-06-01 10:00:00` });

  const { hero } = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.deepEqual(hero.axis.map((t) => t.label).slice(0, 3), ['janv.', 'févr.', 'mars']);
  assert.ok(hero.cumulative.every((p) => p.x === dayOffset(`${Y}-01-01`, p.day)));

  const month = dashboard.getDashboard({ fiscalYear: Y, period: 'month', month: `${Y}-07` }).data.hero;
  assert.equal(month.cumulative.length, 31);
  assert.equal(month.axis[1].label, '8 juil.');
});
