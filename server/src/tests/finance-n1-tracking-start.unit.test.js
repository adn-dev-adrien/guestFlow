const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 33 — last year « as it stood a year ago » is only known
// once GuestFlow tracked booking dates a year ago (the booking pace's start). Before that, a month
// already over compares on last year's final figure, and a month not over yet has no N-1 at all —
// never « contre 0 € l'an dernier » (mega review #5, B1).
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const yoy = require('../utils/yearOverYear');

const Y = Number(TODAY.slice(0, 4));
const MONTH = Number(TODAY.slice(5, 7));
const ym = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
// Every stay was imported recently: nothing existed in GuestFlow a year ago.
const RECENT = `${TODAY} 08:00:00`;

test('rule 33 — the snapshot of a year ago is known only once the tracking start is a year old', () => {
  assert.equal(yoy.lastYearSnapshotKnown('2026-10-18', '2026-04-10'), false);
  assert.equal(yoy.lastYearSnapshotKnown('2027-04-10', '2026-04-10'), true);
  assert.equal(yoy.lastYearSnapshotKnown('2026-10-18', null), false);
  assert.equal(yoy.isMonthOver('2026-09', '2026-10-18'), true);
  assert.equal(yoy.isMonthOver('2026-10', '2026-10-18'), false);
});

test('rule 33 — a comparable range without the snapshot keeps only the months already over', () => {
  const range = yoy.comparableRange({ from: '2026-01-01', to: '2026-12-31' }, '2025-01');
  const clamped = yoy.clampToMonthsOver(range, '2026-10-18');
  assert.deepEqual(clamped.current, { from: '2026-01-01', to: '2026-09-30' });
  assert.deepEqual(clamped.previous, { from: '2025-01-01', to: '2025-09-30' });
  assert.equal(clamped.complete, false);
  assert.equal(yoy.clampToMonthsOver(yoy.comparableRange({ from: '2026-10-01', to: '2026-10-31' }, '2025-01'), '2026-10-18'), null);
});

test('rule 33 — dashboard: N-1 is the final figure of a month over, null for a month not over, never 0 €', () => {
  const { db, dashboard } = freshDb();
  // Last year, same month as today: 900 € — and a month already over this year (January).
  insert(db, { startDate: `${ym(Y - 1, MONTH)}-05`, endDate: `${ym(Y - 1, MONTH)}-08`, balanceAmount: 900, createdAt: RECENT });
  insert(db, { startDate: `${Y - 1}-01-10`, endDate: `${Y - 1}-01-12`, balanceAmount: 300, createdAt: RECENT });
  // This year, the current month: 200 €.
  insert(db, { startDate: `${ym(Y, MONTH)}-20`, endDate: `${ym(Y, MONTH)}-22`, balanceAmount: 200, createdAt: RECENT });

  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  const current = d.revenueMonths.find((m) => m.month === ym(Y, MONTH));
  assert.equal(current.previous, null, 'the month is not over: last year as it stood a year ago is unknown');
  if (MONTH > 1) {
    const january = d.revenueMonths.find((m) => m.month === `${Y}-01`);
    assert.equal(january.previous, 300, 'January is over: its N-1 is last January\'s final figure');
  }
  const best = d.insights.find((i) => i.key === 'bestMonth');
  assert.ok(best, 'the best month is still named');
  assert.doesNotMatch(best.text, /contre 0/, 'never « contre 0 € l\'an dernier »');
});

test('rule 33 — once tracked a year ago, the N-1 « as it stood » applies again', () => {
  const { db, dashboard } = freshDb();
  const longAgo = `${Y - 2}-06-01 10:00:00`;
  insert(db, { startDate: `${ym(Y - 1, MONTH)}-05`, endDate: `${ym(Y - 1, MONTH)}-08`, balanceAmount: 900, createdAt: longAgo });
  insert(db, { startDate: `${ym(Y, MONTH)}-20`, endDate: `${ym(Y, MONTH)}-22`, balanceAmount: 200, createdAt: longAgo });
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(d.revenueMonths.find((m) => m.month === ym(Y, MONTH)).previous, 900);
});
