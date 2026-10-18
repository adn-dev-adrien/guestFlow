const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 38 — each element of « En retard » names the payment flag
// « Marquer payé » ticks for it, and nothing else (review of PR #702, major 1: a late platform payout
// also marked the guest's on-site complement as paid).
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const { refreshDirectChannels } = require('../utils/platformNameFormat');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const daysAgo = (n) => addDaysToIsoDate(TODAY, -n);

function setup() {
  const ctx = freshDb();
  ctx.db.exec('CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, countsAsDirect INTEGER DEFAULT 0, payoutDueDays INTEGER)');
  ctx.db.prepare("INSERT INTO platforms (name, countsAsDirect) VALUES ('Booking', 0)").run();
  refreshDirectChannels(ctx.db);
  return ctx;
}

test.after(() => refreshDirectChannels({ prepare: () => { throw new Error('reset'); } }));

test('rule 38 — a late payout ticks the balance only, never the unpaid complement', () => {
  const { db, dashboard } = setup();
  insert(db, { platform: 'Booking', startDate: daysAgo(28), endDate: daysAgo(25), balanceAmount: 720.82, complementAmount: 132, complementPaid: 0 });
  const row = dashboard.getDashboardDetail('late', {}).data.rows[0];
  assert.deepEqual(row.overdueItems.map((i) => [i.kind, i.paidField]), [['payout', 'balancePaid']]);
});

test('rule 38 — a late guest deposit and balance name their own flags', () => {
  const { db, dashboard } = setup();
  insert(db, { startDate: addDaysToIsoDate(TODAY, 5), endDate: addDaysToIsoDate(TODAY, 8), depositAmount: 100, depositDueDate: daysAgo(10), balanceAmount: 400, balanceDueDate: daysAgo(2), complementAmount: 50 });
  const row = dashboard.getDashboardDetail('late', {}).data.rows[0];
  assert.deepEqual(row.overdueItems.map((i) => [i.kind, i.paidField]), [['deposit', 'depositPaid'], ['balance', 'balancePaid']]);
});
