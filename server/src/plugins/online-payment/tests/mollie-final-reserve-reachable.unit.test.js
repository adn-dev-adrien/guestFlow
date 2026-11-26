// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 10 — a settlement composed from the payments list alone
// does not name which reserve it frees: a reserve picked by amount must be reachable on the credit's day.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const everyItem = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);

test('rule 10 — a reserve paid a week ago is not freed by a payments-list settlement of its amount', () => {
  const stay = paidStay({ cents: 6250, daysAgo: 7 });
  createSettlementsModel(db).store(
    { id: 'stl_f1', reference: '19274230.2611.31', settledAt: null, amountCents: 1250, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 1250, source: 'payments' }, [],
  );
  const { controller, transactions } = build({ startDate: dayAt(-140) });
  transactions.upsertMany([mollieCredit('c1', 1250, 1, { reference: 'REF T19274230.2611.31' })], { bankAccountId: 'acc-1' });
  const reserve = everyItem(controller).find((i) => i.reservation.id === stay.reservationId && i.ledgerKey === 'balance#retenue');
  assert.ok(!reserve.proposal || reserve.proposal.confidence !== 'sur', 'a reserve whose window is weeks away is never « sûr »');
  assert.equal(reserve.state === 'confirmed' || reserve.state === 'done', false);
});
