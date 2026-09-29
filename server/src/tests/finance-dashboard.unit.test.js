const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md — the dashboard payload: one window and a logement filter
// (rules 1-5), the hero and its goal (rules 6-9), the tiles (rules 13-14), the month series (rule 22),
// occupancy (rules 23-24) and the comparison with last year (rules 17-21).
const { freshDb, insert, sum, THIS_YEAR } = require('./financeDashboardFixture');

const Y = THIS_YEAR - 1; // a closed exercise: every figure is final
const early = (year) => `${year - 1}-06-01 10:00:00`; // created long before, so « as it stood » keeps it

function seed(db, year, factor = 1) {
  insert(db, { startDate: `${year}-01-10`, endDate: `${year}-01-13`, balanceAmount: 300 * factor, createdAt: early(year) });
  insert(db, { propertyId: 2, platform: 'Airbnb', startDate: `${year}-07-01`, endDate: `${year}-07-05`, balanceAmount: 500 * factor, platformCommissionAmount: 75 * factor, createdAt: early(year) });
  insert(db, { requestOrigin: 'public', attributionChannel: 'social', startDate: `${year}-07-20`, endDate: `${year}-07-22`, balanceAmount: 400 * factor, createdAt: early(year) });
}

test('rules 3, 5, 22 — hero, months and logements all add up, and the filter narrows every figure', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y);
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(d.hero.revenue, 1125);
  assert.equal(sum(d.revenueMonths, 'revenue'), d.hero.revenue);
  assert.equal(sum(d.properties, 'revenue'), d.hero.revenue);
  assert.equal(d.hero.stays, 3);
  assert.equal(d.hero.nights, 9);
  assert.equal(d.hero.directShare, 0.6222);
  const lodge = dashboard.getDashboard({ fiscalYear: Y, propertyId: 2 }).data;
  assert.equal(lodge.hero.revenue, 425);
  assert.equal(sum(lodge.revenueMonths, 'revenue'), 425);
  assert.deepEqual(lodge.occupancy.map((o) => o.propertyId), [2]);
  assert.equal(lodge.properties.length, 3, 'the strip keeps every logement to switch to');
});

test('rules 1-2 — a month window, and refusals for a bad window or an unknown logement', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y);
  const july = dashboard.getDashboard({ fiscalYear: Y, period: 'month', month: `${Y}-07` }).data;
  assert.equal(july.hero.revenue, 825);
  assert.equal(july.revenueMonths.filter((m) => m.inWindow).length, 1);
  assert.deepEqual(dashboard.getDashboard({ fiscalYear: Y, period: 'custom', from: `${Y}-09-01`, to: `${Y}-08-01` }), { ok: false, status: 400, error: 'La date de début doit précéder la date de fin.' });
  assert.equal(dashboard.getDashboard({ fiscalYear: Y, propertyId: 99 }).status, 400);
});

test('rule 7 — the goal shows only on the whole exercise, without a logement filter', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y);
  db.prepare('UPDATE app_settings SET revenueGoals = ? WHERE id = 1').run(JSON.stringify({ [Y]: 2250 }));
  assert.deepEqual(dashboard.getDashboard({ fiscalYear: Y }).data.hero.goal, { amount: 2250, ratio: 0.5, remaining: 1125 });
  assert.equal(dashboard.getDashboard({ fiscalYear: Y, propertyId: 1 }).data.hero.goal, null);
  assert.equal(dashboard.getDashboard({ fiscalYear: Y, period: 'month', month: `${Y}-07` }).data.hero.goal, null);
  assert.equal(dashboard.getDashboard({ fiscalYear: Y - 1 }).data.hero.goal, null);
});

test('rule 14 — « À encaisser » and « En retard » ignore the window but honour the logement', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y);
  // A finished direct stay from an older exercise, balance overdue and unpaid.
  insert(db, { startDate: `${Y - 3}-05-01`, endDate: `${Y - 3}-05-03`, balanceAmount: 200, balanceDueDate: `${Y - 3}-04-01`, createdAt: early(Y - 3) });
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(d.tiles.late.stays, 1);
  assert.equal(d.tiles.late.amount, 200);
  assert.ok(d.tiles.toCollect.stays >= 1);
  assert.equal(dashboard.getDashboard({ fiscalYear: Y, propertyId: 2 }).data.tiles.late.stays, 0);
  assert.equal(d.insights.find((i) => i.key === 'late').tone, 'error');
});

test('rule 13 — the tiles carry what their table details, and the channel commission', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y);
  const t = dashboard.getDashboard({ fiscalYear: Y }).data.tiles;
  assert.equal(t.stays.count, 3);
  assert.equal(t.properties.count, 3);
  assert.equal(t.properties.leader, 'Gite');
  assert.equal(t.channels.commission, 75);
});

test('rules 17-21 — last year is compared month by month, only where it has data', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y - 1);
  seed(db, Y, 2);
  const full = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.deepEqual(
    { current: full.hero.yoy.current, previous: full.hero.yoy.previous, change: full.hero.yoy.change, months: full.hero.yoy.months },
    { current: 2250, previous: 1125, change: 100, months: 12 },
  );
  assert.equal(full.revenueMonths[6].previous, 825);
  assert.ok(full.hero.cumulative.some((p) => p.previous != null), 'a fully comparable window draws last year\'s curve');

  // Coverage starting in July of Y-1: January is not comparable, July is.
  const late = freshDb();
  insert(late.db, { startDate: `${Y - 1}-07-01`, endDate: `${Y - 1}-07-03`, balanceAmount: 100, createdAt: early(Y - 1) });
  seed(late.db, Y);
  const partial = late.dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(partial.hero.yoy.months, 6);
  assert.equal(partial.revenueMonths[0].previous, null);
  assert.equal(partial.revenueMonths[6].previous, 100);
  assert.ok(partial.hero.cumulative.every((p) => p.previous == null), 'no curve until the whole window is comparable');

  // No history at all: no comparison anywhere.
  const fresh = freshDb();
  seed(fresh.db, Y);
  const none = fresh.dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(none.hero.yoy, null);
  assert.ok(none.revenueMonths.every((m) => m.previous == null));
});

test('rules 23-24 — occupancy per logement and month: closures and months before the data are gaps', () => {
  const { db, dashboard } = freshDb();
  seed(db, Y);
  db.prepare('INSERT INTO establishment_closures (propertyId, startDate, endDate) VALUES (1, ?, ?)').run(`${Y}-02-01`, `${Y}-03-01`);
  const occ = dashboard.getDashboard({ fiscalYear: Y }).data.occupancy;
  const gite = occ.find((o) => o.propertyId === 1).months;
  assert.equal(gite[0].current, Math.round((3 / 31) * 10000) / 10000);
  assert.equal(gite[1].current, null, 'closed all February');
  const lodge = occ.find((o) => o.propertyId === 2).months;
  assert.equal(lodge[5].current, null, 'no data before its first stay in July');
  assert.equal(lodge[6].current, Math.round((4 / 31) * 10000) / 10000);
  assert.equal(occ.find((o) => o.propertyId === 3).average, null, 'a logement never booked has no rate');
});
