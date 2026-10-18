const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 40 — a late platform payout is counted at what the
// platform owes: the solde net of its commission, the figure « À encaisser » counts too. Final review
// 2026-10-18, N2: « En retard » showed GdF 11 at 1 933,52 € and Abracadaroom 22275 at 720,82 € while
// their fiches recorded payouts of 1 545 € and 573,77 €.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const { refreshDirectChannels } = require('../utils/platformNameFormat');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const daysAgo = (n) => addDaysToIsoDate(TODAY, -n);

function setup() {
  const ctx = freshDb();
  ctx.db.exec('CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, countsAsDirect INTEGER DEFAULT 0, payoutDueDays INTEGER)');
  ctx.db.prepare("INSERT INTO platforms (name, countsAsDirect) VALUES ('GitesDeFrance', 0), ('Abracadaroom', 0)").run();
  refreshDirectChannels(ctx.db);
  return ctx;
}

test.after(() => refreshDirectChannels({ prepare: () => { throw new Error('reset'); } }));

test('rule 40 — GdF 11 and Abracadaroom 22275: « En retard » shows the payouts, as « À encaisser » does', () => {
  const { db, dashboard } = setup();
  // GdF 11: solde 1 933,52 €, commission 388,52 € → payout 1 545 €.
  insert(db, {
    platform: 'GitesDeFrance', startDate: daysAgo(60), endDate: daysAgo(55),
    finalPrice: 1954.52, balanceAmount: 1933.52, platformCommissionAmount: 388.52,
  });
  // Abracadaroom 22275: solde 720,82 €, commission 147,05 € → payout 573,77 €.
  insert(db, {
    platform: 'Abracadaroom', startDate: daysAgo(62), endDate: daysAgo(57),
    finalPrice: 865.82, touristTaxTotal: 13.05, balanceAmount: 720.82, platformCommissionAmount: 147.05,
  });

  const d = dashboard.getDashboard({}).data;
  assert.deepEqual({ amount: d.tiles.late.amount, payouts: d.tiles.late.payouts }, { amount: 2118.77, payouts: 2 });

  const detail = dashboard.getDashboardDetail('late', {}).data;
  const byLabel = Object.fromEntries(detail.rows.map((r) => [r.overdueItems[0].label, r.overdueItems[0].amount]));
  assert.deepEqual(byLabel, { 'Versement Gîtes de France': 1545, 'Versement Abracadaroom': 573.77 });
  assert.deepEqual(detail.totals.payouts, { count: 2, totalAmount: 2118.77 });

  const toCollect = dashboard.getDashboardDetail('toCollect', {}).data;
  const remaining = Object.fromEntries(toCollect.rows.map((r) => [r.platform, r.remainingToPay]));
  assert.equal(remaining.GitesDeFrance, 1545, 'the same figure on both tiles');
  assert.equal(remaining.Abracadaroom, 573.77);
});

test('rule 40 — without a commission the payout is the solde', () => {
  const { db, dashboard } = setup();
  insert(db, { platform: 'GitesDeFrance', startDate: daysAgo(40), endDate: daysAgo(35), balanceAmount: 706 });
  const row = dashboard.getDashboardDetail('late', {}).data.rows[0];
  assert.equal(row.overdueItems[0].amount, 706);
  assert.equal(row.overdueAmount, 706);
});

test('rule 40 — the home dashboard card claims the same payout', () => {
  const { buildPaymentDeadlineRow } = require('../utils/paymentDeadlines');
  const out = buildPaymentDeadlineRow({
    id: 11, platform: 'GitesDeFrance', startDate: '2026-08-17', endDate: '2026-08-24', finalPrice: 1954.52,
    depositAmount: 0, depositPaid: 0, balanceAmount: 1933.52, balancePaid: 0, platformCommissionAmount: 388.52,
    payoutDueDays: 10, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Gîte',
  }, '2026-09-10');
  assert.equal(out.state, 'platform_payout_overdue');
  assert.equal(out.balanceDue, 1545);
  assert.equal(out.totalDue, 1545);
});
