const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 42 — a platform payout of 0 € (commission ≥ solde) is never
// late: no row in « En retard », no stay counted, no home dashboard card. Final review 2026-10-18
// (minor 4): the row stayed in the list at 0 € and counted as a stay.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const { refreshDirectChannels } = require('../utils/platformNameFormat');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { buildPaymentDeadlineRow } = require('../utils/paymentDeadlines');

const daysAgo = (n) => addDaysToIsoDate(TODAY, -n);

test.after(() => refreshDirectChannels({ prepare: () => { throw new Error('reset'); } }));

test('rule 42 — commission equal to the solde: nothing late on the finance page', () => {
  const ctx = freshDb();
  ctx.db.exec('CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, countsAsDirect INTEGER DEFAULT 0, payoutDueDays INTEGER)');
  ctx.db.prepare("INSERT INTO platforms (name, countsAsDirect) VALUES ('GitesDeFrance', 0)").run();
  refreshDirectChannels(ctx.db);
  insert(ctx.db, {
    platform: 'GitesDeFrance', startDate: daysAgo(60), endDate: daysAgo(55),
    finalPrice: 200, balanceAmount: 120, platformCommissionAmount: 120,
  });
  insert(ctx.db, {
    platform: 'GitesDeFrance', startDate: daysAgo(50), endDate: daysAgo(45),
    finalPrice: 300, balanceAmount: 300, platformCommissionAmount: 60,
  });

  const d = ctx.dashboard.getDashboard({}).data;
  assert.deepEqual({ amount: d.tiles.late.amount, payouts: d.tiles.late.payouts }, { amount: 240, payouts: 1 });
  const detail = ctx.dashboard.getDashboardDetail('late', {}).data;
  assert.deepEqual(detail.rows.map((r) => r.overdueAmount), [240]);
});

test('rule 42 — the home dashboard card leaves a 0 € payout out', () => {
  const out = buildPaymentDeadlineRow({
    id: 12, platform: 'GitesDeFrance', startDate: '2026-08-17', endDate: '2026-08-24', finalPrice: 200,
    depositAmount: 0, depositPaid: 0, balanceAmount: 120, balancePaid: 0, platformCommissionAmount: 150,
    payoutDueDays: 10, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Gîte',
  }, '2026-09-10');
  assert.equal(out, null);
});
