const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 34 — « En retard » covers every own-channel stay
// (`isDirectChannel`, never `platform === 'direct'`) and the platforms' payouts that are late
// (mega review #5, B2: « Aucun paiement en retard » while a Lodgify-as-direct solde and two platform
// payouts were overdue).
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const { refreshDirectChannels } = require('../utils/platformNameFormat');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const daysAgo = (n) => addDaysToIsoDate(TODAY, -n);

function setup() {
  const ctx = freshDb();
  ctx.db.exec('CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, countsAsDirect INTEGER DEFAULT 0, payoutDueDays INTEGER)');
  ctx.db.prepare("INSERT INTO platforms (name, countsAsDirect) VALUES ('Lodgify', 1), ('Booking', 0)").run();
  refreshDirectChannels(ctx.db);
  return ctx;
}

test.after(() => refreshDirectChannels({ prepare: () => { throw new Error('reset'); } }));

test('rule 34 — a platform counted as direct is chased like a direct booking', () => {
  const { db, dashboard } = setup();
  insert(db, { platform: 'Lodgify', startDate: addDaysToIsoDate(TODAY, 20), endDate: addDaysToIsoDate(TODAY, 23), balanceAmount: 500, balanceDueDate: daysAgo(17) });
  const d = dashboard.getDashboard({}).data;
  assert.equal(d.tiles.late.stays, 1);
  assert.equal(d.tiles.late.amount, 500);
  assert.equal(d.tiles.late.payouts, 0);
  assert.equal(d.insights.find((i) => i.key === 'late').tone, 'error');
});

test('rule 34 — a platform payout past departure + its delay is late, one before is not', () => {
  const { db, dashboard } = setup();
  // Departed 25 days ago, default payout delay 10 days → late by 15 days.
  insert(db, { platform: 'Booking', startDate: daysAgo(28), endDate: daysAgo(25), balanceAmount: 140.97 });
  // Departed 3 days ago → the payout is not due yet.
  insert(db, { platform: 'Booking', startDate: daysAgo(6), endDate: daysAgo(3), balanceAmount: 300 });
  // Paid by the platform → nothing late.
  insert(db, { platform: 'Booking', startDate: daysAgo(40), endDate: daysAgo(38), balanceAmount: 200, balancePaid: 1, balancePaidDate: daysAgo(30) });
  const d = dashboard.getDashboard({}).data;
  assert.deepEqual({ stays: d.tiles.late.stays, amount: d.tiles.late.amount, payouts: d.tiles.late.payouts }, { stays: 1, amount: 140.97, payouts: 1 });
  const late = d.insights.find((i) => i.key === 'late');
  assert.equal(late.tone, 'error');
  assert.match(late.text.replace(/\s/g, ' '), /versement plateforme attendu/);

  const detail = dashboard.getDashboardDetail('late', {}).data;
  assert.equal(detail.rows.length, 1);
  assert.deepEqual(detail.rows[0].overdueItems.map((i) => [i.kind, i.label, i.amount, i.dueDate]), [['payout', 'Versement Booking', 140.97, daysAgo(15)]]);
  assert.deepEqual(detail.totals.payouts, { count: 1, totalAmount: 140.97 });
});

test('rule 34 — the payout is named by the platform\'s display name', () => {
  const { db, dashboard } = setup();
  insert(db, { platform: 'GitesDeFrance', startDate: daysAgo(28), endDate: daysAgo(25), balanceAmount: 706 });
  const row = dashboard.getDashboardDetail('late', {}).data.rows[0];
  assert.equal(row.overdueItems[0].label, 'Versement Gîtes de France');
});

test('rule 34 — guests and payouts late together: the insight names both', () => {
  const { db, dashboard } = setup();
  insert(db, { startDate: addDaysToIsoDate(TODAY, 5), endDate: addDaysToIsoDate(TODAY, 8), balanceAmount: 400, balanceDueDate: daysAgo(2) });
  insert(db, { platform: 'Booking', startDate: daysAgo(30), endDate: daysAgo(27), balanceAmount: 100 });
  const d = dashboard.getDashboard({}).data;
  assert.equal(d.tiles.late.stays, 2);
  assert.equal(d.tiles.late.amount, 500);
  const text = d.insights.find((i) => i.key === 'late').text.replace(/\s/g, ' ');
  assert.match(text, /500 € à relancer, dont 100 € de versements plateforme/);
});
