// specs/mollie-rolling-reserve-and-incoming-payments.md rules 28-31 — what the plugin tells the accounting export: a paid link
// on its payment day, a reconciled credit on its bank day, the settlement's costs, the clearing balance at a date (exactly the
// money still at Mollie), and the credits it could not attach. The measured pair: 196,80 € = 157,44 € then 39,36 €.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const START = dayAt(-140);

function pair() {
  const stay = paidStay({ cents: 19680, daysAgo: 100 });
  const built = build({ startDate: START });
  built.transactions.upsertMany([
    mollieCredit('c1', 15744, 95, { reference: 'REF T19274230.2512.01', transactionId: 'solio-6791-1-transaction-019d-0001' }),
    mollieCredit('c2', 3936, 5, { reference: 'REF T19274230.2603.01', transactionId: 'solio-6791-1-transaction-019d-0002' }),
  ], { bankAccountId: 'acc-1' });
  return { ...stay, ...built };
}

test('rule 28 — the paid link is booked on its payment day, the credits on their bank days, with both references', () => {
  const { controller, reservationId } = pair();
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 15744 }], user: { id: 1 } });
  controller.confirm({ transactionId: 'c2', allocations: [{ reservationId, ledgerKey: 'balance#retenue', amountCents: 3936 }], user: { id: 1 } });
  const day = (n) => ({ from: dayAt(n), to: dayAt(n) });
  const linkDay = controller.journal(day(-100)).entries;
  assert.deepEqual(linkDay.map((e) => [e.kind, e.amountCents, e.reservationId]), [['link', 19680, reservationId]]);
  assert.deepEqual(linkDay[0].client, { firstName: 'Jean', lastName: 'Dupont' });
  const first = controller.journal(day(-95)).entries;
  assert.deepEqual(first.map((e) => [e.kind, e.amountCents, e.date]), [['credit', 15744, dayAt(-95)]]);
  assert.equal(first[0].settlementReference, 'T19274230.2512.01');
  assert.equal(first[0].qontoReference, 'solio-6791-1-transaction-019d-0001');
  assert.equal(controller.journal(day(-5)).entries[0].amountCents, 3936);
});

test('rule 28 — the clearing balance at any date is exactly the money still at Mollie: 196,80, then 39,36, then 0', () => {
  const { controller, reservationId } = pair();
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 15744 }], user: { id: 1 } });
  controller.confirm({ transactionId: 'c2', allocations: [{ reservationId, ledgerKey: 'balance#retenue', amountCents: 3936 }], user: { id: 1 } });
  const balance = (n) => controller.journal({ from: dayAt(n), to: dayAt(n) }).clearing;
  assert.equal(balance(-100).balanceCents, 19680);
  assert.equal(balance(-96).balanceCents, 19680);
  assert.equal(balance(-95).balanceCents, 3936, 'the immediate share arrived: the reserve is what Mollie still holds');
  assert.deepEqual(balance(-95).clients, [{ reservationId, clientName: 'Jean Dupont', balanceCents: 3936 }]);
  assert.equal(balance(-5).balanceCents, 0);
  assert.deepEqual(balance(-5).clients, []);
  assert.equal(balance(-101).balanceCents, 0, 'before the payment Mollie owes nothing');
});

test('rule 28 — the costs of a reconciled credit\'s settlement are booked with it, and leave the clearing balance', () => {
  const { reservationId, controller } = pair();
  createSettlementsModel(db).store(
    { id: 'stl_1', reference: 'T19274230.2512.01', settledAt: null, amountCents: 15744, costsCents: 45, reserveHeldCents: 0, reserveReleasedCents: 0 }, [],
  );
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 15744 }], user: { id: 1 } });
  const found = controller.journal({ from: dayAt(-95), to: dayAt(-95) });
  assert.deepEqual(found.entries.map((e) => [e.kind, e.amountCents]), [['credit', 15744], ['cost', 45]]);
  assert.equal(found.clearing.balanceCents, 19680 - 15744 - 45);
});

test('rule 31 — a Mollie credit not reconciled is listed as unattached and books nothing', () => {
  const { controller } = pair();
  const found = controller.journal({ from: dayAt(-95), to: dayAt(-95) });
  assert.deepEqual(found.entries.filter((e) => e.kind === 'credit'), []);
  assert.deepEqual(found.unattached, [{
    date: dayAt(-95), amountCents: 15744, qontoReference: 'solio-6791-1-transaction-019d-0001', settlementReference: 'T19274230.2512.01', counterparty: 'Stichting Mollie Payments',
  }]);
  assert.equal(found.clearing.balanceCents, 19680, 'nothing reconciled yet: Mollie still owes it all');
});

test('rule 31 — a credit set aside as « hors réservation » is not unattached', () => {
  const { controller, model } = pair();
  model.markOutside('c1');
  assert.deepEqual(controller.journal({ from: dayAt(-95), to: dayAt(-95) }).unattached, []);
});
