// specs/reconciliation-assisted-matching.md rule 27 — the finance pages count a platform stay net of its
// penalties: « total de séjour », « encaissé », « à encaisser », a late payout and the cash-flow line, with
// the invariant collected + remaining = total kept. Same stay with and without a penalty.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const daysAgo = (n) => addDaysToIsoDate(TODAY, -n);

function world(penalty) {
  const ctx = freshDb();
  ctx.db.exec('ALTER TABLE reservations ADD COLUMN platformPenaltyAmount REAL NOT NULL DEFAULT 0');
  insert(ctx.db, {
    platform: 'Booking', startDate: daysAgo(40), endDate: daysAgo(35), finalPrice: 800, balanceAmount: 800, platformCommissionAmount: 190,
    balancePaid: 1, balancePaidDate: daysAgo(30), platformPenaltyAmount: penalty,
  });
  insert(ctx.db, {
    platform: 'Booking', startDate: daysAgo(60), endDate: daysAgo(55), finalPrice: 500, balanceAmount: 500, platformCommissionAmount: 100,
    platformPenaltyAmount: penalty,
  });
  return ctx;
}

test('rule 27 — revenue, collected and to-collect drop by the penalty, never the commission', () => {
  const plain = world(0).dashboard.getDashboard({}).data;
  const penalised = world(40).dashboard.getDashboard({}).data;
  assert.equal(plain.hero.revenue, 610 + 400);
  assert.equal(penalised.hero.revenue, 570 + 360);
  assert.equal(plain.tiles.collected.amount - penalised.tiles.collected.amount, 40);
  assert.equal(plain.tiles.toCollect.amount - penalised.tiles.toCollect.amount, 40);
  assert.equal(penalised.hero.revenue, penalised.tiles.collected.amount + penalised.tiles.toCollect.amount, 'collected + remaining = total');
});

test('rule 27 — a late payout is owed net of the penalty', () => {
  const plain = world(0).dashboard.getDashboardDetail('late', {}).data;
  const penalised = world(40).dashboard.getDashboardDetail('late', {}).data;
  assert.equal(plain.rows[0].overdueItems[0].amount, 400);
  assert.equal(penalised.rows[0].overdueItems[0].amount, 360);
});

test('rule 27 — the cash-flow line of a received payout is net of the penalty', () => {
  const plain = world(0).dashboard.getDashboardDetail('collected', {}).data;
  const penalised = world(40).dashboard.getDashboardDetail('collected', {}).data;
  assert.equal(plain.rows.find((r) => r.kind === 'balance').amount, 610);
  assert.equal(penalised.rows.find((r) => r.kind === 'balance').amount, 570);
});
