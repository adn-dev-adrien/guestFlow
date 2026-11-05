const test = require('node:test');
const assert = require('node:assert/strict');

// The clock is pinned for the whole file (specs/server-test-isolation.md rule 7): « today » is the day the
// comparisons were written against, so no date below is ever passed by the calendar.
require('node:test').mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 11) });

// specs/finance-revpar-year-over-year.md §3 rules 4, 5, 6, 8, 10, 11 and 13 — the dashboard's
// `comparison`: the headline figures against the comparable part of the window a year back, read by
// the functions that compute the figures themselves, with their source.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const { pinnedDashboard } = require('./financeComparisonFixture');
const { addDays } = require('../utils/financeOccupancy');
const yoy = require('../utils/yearOverYear');

const Y = Number(TODAY.slice(0, 4));
const MONTH = Number(TODAY.slice(5, 7));
const ym = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const KEYS = ['revenue', 'collected', 'stays', 'nights', 'occupancy', 'revenuePerNight', 'revPar'];

test('rule 8 — exercise 2024 against 2023, on the 8 comparable months, every figure', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard({ fiscalYear: 2024 }).data;
  const c = d.comparison;
  assert.equal(c.comparable, true);
  assert.equal(c.reason, null);
  assert.equal(c.months, 8);
  assert.equal(c.totalMonths, 12);
  assert.equal(c.notice, 'Comparaison sur 8 mois sur 12 : les données commencent en mai 2023.');
  assert.deepEqual(Object.keys(c.metrics), KEYS);
  const pick = (k) => { const { current, previous, change, unit } = c.metrics[k]; return { current, previous, change, unit }; };
  assert.deepEqual(pick('revenue'), { current: 1400, previous: 1000, change: 40, unit: 'percent' });
  assert.deepEqual(pick('collected'), { current: 1400, previous: 1000, change: 40, unit: 'percent' });
  assert.deepEqual(pick('stays'), { current: 4, previous: 3, change: 33.3, unit: 'percent' });
  assert.deepEqual(pick('nights'), { current: 15, previous: 10, change: 50, unit: 'percent' });
  // May-December: 2024 open 245 + 214 = 459, 17 sold; 2023 open 245 + 153 (Tente from August) = 398, 10 sold.
  assert.deepEqual(pick('occupancy'), { current: 0.037, previous: 0.0251, change: 1.2, unit: 'points' });
  assert.deepEqual(pick('revenuePerNight'), { current: 107.69, previous: 100, change: 7.7, unit: 'percent' });
  assert.deepEqual(pick('revPar'), { current: 3.05, previous: 2.51, change: 21.5, unit: 'percent' });
});

test('rule 8 — the revenue comparison is the hero badge, one figure read once', () => {
  const { dashboard } = pinnedDashboard();
  for (const params of [{ fiscalYear: 2024 }, { fiscalYear: 2024, propertyId: 2 }, { fiscalYear: 2024, period: 'month', month: '2024-08' }]) {
    const d = dashboard.getDashboard(params).data;
    const r = d.comparison.metrics.revenue;
    assert.deepEqual({ current: r.current, previous: r.previous, change: r.change }, { current: d.hero.yoy.current, previous: d.hero.yoy.previous, change: d.hero.yoy.change });
    assert.equal(d.comparison.months, d.hero.yoy.months);
  }
});

test('rule 8 — a complete comparison reads this year\'s side as the tiles show it', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard({ fiscalYear: 2024, period: 'month', month: '2024-08' }).data;
  const m = d.comparison.metrics;
  assert.equal(d.comparison.complete, true);
  assert.equal(d.comparison.notice, null);
  assert.equal(m.revenue.current, d.hero.revenue);
  assert.equal(m.collected.current, d.tiles.collected.amount);
  assert.equal(m.stays.current, d.tiles.stays.count);
  assert.equal(m.nights.current, d.hero.nights);
  assert.equal(m.occupancy.current, d.hero.occupancy);
  assert.equal(m.revenuePerNight.current, d.hero.revenuePerNight);
  assert.equal(m.revPar.current, d.hero.revPar);
});

test('rule 13 — each figure names its source: the stays\' amounts, or the money collected', () => {
  const { dashboard } = pinnedDashboard();
  const { metrics } = dashboard.getDashboard({ fiscalYear: 2024 }).data.comparison;
  assert.deepEqual(Object.fromEntries(KEYS.map((k) => [k, metrics[k].source])), {
    revenue: 'stays', collected: 'payments', stays: 'stays', nights: 'stays', occupancy: 'stays', revenuePerNight: 'stays', revPar: 'stays',
  });
  const none = freshDb().dashboard.getDashboard({ fiscalYear: Y }).data.comparison.metrics;
  assert.equal(none.collected.source, 'payments', 'the source is there when nothing compares too');
});

test('rule 10 — a logement closed all last month: its rates have no base, the money still compares', () => {
  const { db, dashboard } = freshDb({ properties: ['Gite'] });
  db.prepare("INSERT INTO establishment_closures (propertyId, startDate, endDate) VALUES (NULL, '2023-02-01', '2023-03-01')").run();
  insert(db, { id: 1, propertyId: 1, startDate: '2023-01-28', endDate: '2023-01-31', balanceAmount: 300, balancePaid: 1, balancePaidDate: '2023-02-02', createdAt: '2023-01-02 10:00:00' });
  insert(db, { id: 2, propertyId: 1, startDate: '2024-02-10', endDate: '2024-02-15', balanceAmount: 500, balancePaid: 1, balancePaidDate: '2024-02-15', createdAt: '2023-01-02 10:00:00' });
  const m = dashboard.getDashboard({ fiscalYear: 2024, period: 'month', month: '2024-02' }).data.comparison.metrics;
  assert.equal(m.revenue.comparable, true);
  assert.equal(m.revenue.change, 66.7);
  assert.deepEqual([m.occupancy.comparable, m.occupancy.reason, m.occupancy.previous], [false, 'noPreviousValue', null]);
  assert.deepEqual([m.revPar.comparable, m.revPar.reason, m.revPar.previous], [false, 'noPreviousValue', null]);
});

test('rule 11 — a custom window starting before last exercise reads its own last year', () => {
  const { db, dashboard } = freshDb({ properties: ['Gite'] });
  const base = Y - 3;
  insert(db, { id: 1, propertyId: 1, startDate: `${base - 1}-04-10`, endDate: `${base - 1}-04-14`, balanceAmount: 400, balancePaid: 1, balancePaidDate: `${base - 1}-04-14`, createdAt: `${base - 1}-01-02 10:00:00` });
  insert(db, { id: 2, propertyId: 1, startDate: `${base}-04-10`, endDate: `${base}-04-12`, balanceAmount: 200, balancePaid: 1, balancePaidDate: `${base}-04-12`, createdAt: `${base - 1}-01-02 10:00:00` });
  const d = dashboard.getDashboard({ fiscalYear: Y - 2, period: 'custom', from: `${base}-03-01`, to: `${base}-06-30` }).data;
  const m = d.comparison.metrics;
  assert.deepEqual(d.comparison.previous, { from: `${base - 1}-04-01`, to: `${base - 1}-06-30` }, 'clamped to the coverage start');
  assert.equal(m.occupancy.previous, 0.044, '4 nights ÷ 91 open nights (April-June), read before last exercise');
  assert.equal(m.nights.previous, 4);
});

test('rule 5 — no data a year back: every figure « not comparable », one reason, one notice', () => {
  const { db, dashboard } = freshDb();
  insert(db, { propertyId: 1, startDate: `${ym(Y, MONTH)}-01`, endDate: `${ym(Y, MONTH)}-03`, balanceAmount: 200, createdAt: `${TODAY} 08:00:00` });
  const c = dashboard.getDashboard({ fiscalYear: Y }).data.comparison;
  assert.equal(c.comparable, false);
  assert.equal(c.reason, 'noHistory');
  assert.match(c.notice, /les données commencent en/);
  for (const k of KEYS) {
    assert.equal(c.metrics[k].comparable, false);
    assert.equal(c.metrics[k].reason, 'noHistory');
    assert.equal(c.metrics[k].change, null);
  }
});

test('rule 6 — the month in progress without last year\'s snapshot: « notYetKnown » and the day it comes', () => {
  const { db, dashboard } = freshDb();
  const recent = `${TODAY} 08:00:00`;
  insert(db, { propertyId: 1, startDate: `${ym(Y - 1, MONTH)}-05`, endDate: `${ym(Y - 1, MONTH)}-08`, balanceAmount: 900, createdAt: recent });
  insert(db, { propertyId: 1, startDate: `${ym(Y, MONTH)}-01`, endDate: `${ym(Y, MONTH)}-03`, balanceAmount: 200, createdAt: recent });
  const c = dashboard.getDashboard({ fiscalYear: Y, period: 'month', month: ym(Y, MONTH) }).data.comparison;
  assert.equal(c.comparable, false);
  assert.equal(c.reason, 'notYetKnown');
  const nextMonth = MONTH === 12 ? `${Y + 1}-01-01` : `${ym(Y, MONTH + 1)}-01`;
  assert.equal(c.comparableFrom, nextMonth);
  assert.match(c.notice, /^Comparaison avec l'an dernier à partir du /);
  assert.equal(c.metrics.occupancy.reason, 'notYetKnown');
  assert.equal(c.metrics.revenue.current, null);
});

test('rule 10 — « Encaissé » a year ago as it stood: a payment received after that day is left out', () => {
  const { db, dashboard } = freshDb();
  const knownN1 = yoy.shiftYear(TODAY, -1);
  const longAgo = `${Y - 3}-06-01 10:00:00`;
  insert(db, {
    propertyId: 1, startDate: `${Y - 1}-01-10`, endDate: `${Y - 1}-01-12`, createdAt: longAgo,
    balanceAmount: 400, balancePaid: 1, balancePaidDate: `${Y - 1}-01-12`,
    depositAmount: 100, depositPaid: 1, depositPaidDate: addDays(knownN1, 1),
  });
  insert(db, {
    propertyId: 1, startDate: addDays(TODAY, -3), endDate: addDays(TODAY, -1), createdAt: longAgo,
    balanceAmount: 600, balancePaid: 1, balancePaidDate: TODAY,
  });
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  const m = d.comparison.metrics.collected;
  assert.equal(d.comparison.complete, true);
  assert.equal(m.previous, 400, 'the 100 € acompte came in after the same day last year');
  assert.equal(m.current, d.tiles.collected.amount);
  assert.equal(d.comparison.metrics.revenue.previous, 500, 'the revenue of a stay known then counts whole, as on the hero badge');
});
