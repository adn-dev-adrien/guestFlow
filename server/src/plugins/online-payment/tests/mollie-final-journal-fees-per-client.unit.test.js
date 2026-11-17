// specs/mollie-rolling-reserve-and-incoming-payments.md rules 5 and 28 — the clearing of Mollie per client takes the fees off
// as well as the credits: the client list always sums to the total.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const window = { from: dayAt(-20), to: dayAt(-1) };

test('rule 28 — 100,00 € link, credits 78,35 + 20,00 and the estimated fee 1,65: balance 0 and no client left', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 20 });
  const { controller, transactions } = build({ startDate: dayAt(-140) });
  transactions.upsertMany([mollieCredit('c1', 7835, 15), mollieCredit('c2', 2000, 2)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 7835 }], user: { id: 1 } });
  controller.confirm({ transactionId: 'c2', allocations: [{ reservationId, ledgerKey: 'balance#retenue', amountCents: 2000 }], user: { id: 1 } });
  const { clearing } = controller.journal(window);
  assert.equal(clearing.balanceCents, 0);
  assert.deepEqual(clearing.clients, []);
});

test('rule 28 — the settlement\'s own costs leave the client\'s clearing too', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 20 });
  createSettlementsModel(db).store({ id: 'stl_f2', reference: '19274230.2611.32', settledAt: null, amountCents: 7835, costsCents: 165, reserveHeldCents: 2000, reserveReleasedCents: 0, source: 'balance' },
    [{ id: 'tr_f2', kind: 'immediate', amountCents: 7835, splitId: 'link:1' }]);
  const { controller, transactions } = build({ startDate: dayAt(-140) });
  transactions.upsertMany([mollieCredit('c1', 7835, 15, { reference: 'REF T19274230.2611.32' }), mollieCredit('c2', 2000, 2)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 7835 }], user: { id: 1 } });
  controller.confirm({ transactionId: 'c2', allocations: [{ reservationId, ledgerKey: 'balance#retenue', amountCents: 2000 }], user: { id: 1 } });
  const { clearing } = controller.journal(window);
  assert.equal(clearing.balanceCents, 0);
  assert.equal(clearing.clients.reduce((t, c) => t + c.balanceCents, 0), clearing.balanceCents);
});
