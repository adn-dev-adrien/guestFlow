// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 5, 6 and 28-31 — what the clearing account of Mollie books when a
// credit comes short by the fees, when a payment was refunded, when a settlement holds payments GuestFlow does not know, and
// on which day (Paris, never UTC). Fictional data, dates relative to today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { db, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const START = dayAt(-140);
const window = (from, to) => ({ from: dayAt(from), to: dayAt(to) });

test('rule 5 — a credit confirmed short by the estimated fees (no token) books that gap as a cost, and the clearing balance is the reserve alone', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 20 });
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 7835, 15)], { bankAccountId: 'acc-1' });
  assert.equal(controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 7835 }], user: { id: 1 } }).status, 201);
  const found = controller.journal(window(-20, -10));
  assert.deepEqual(found.entries.map((e) => [e.kind, e.amountCents]), [['link', 10000], ['credit', 7835], ['cost', 165]]);
  assert.equal(found.entries.find((e) => e.kind === 'cost').libelle, 'FRAIS MOLLIE ESTIMÉS');
  assert.equal(found.clearing.balanceCents, 2000, 'what Mollie still holds is the 20 % reserve, to the cent');
});

test('rule 5 — when the settlement states its costs they are booked once, never beside the estimate', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 20 });
  createSettlementsModel(db).store({ id: 'stl_c', reference: '19274230.2611.11', settledAt: null, amountCents: 7835, costsCents: 165, reserveHeldCents: 2000, reserveReleasedCents: 0, source: 'balance' },
    [{ id: 'tr_k', kind: 'immediate', amountCents: 7835, splitId: 'link:1' }]);
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 7835, 15, { reference: 'REF T19274230.2611.11' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 7835 }], user: { id: 1 } });
  const costs = controller.journal(window(-20, -10)).entries.filter((e) => e.kind === 'cost');
  assert.deepEqual(costs.map((e) => [e.amountCents, e.libelle]), [[165, 'FRAIS MOLLIE']]);
});

test('rule 6 — a refund reduces what Mollie owes: the link is booked net of it and the clearing account closes at zero', () => {
  const { reservationId, link } = paidStay({ cents: 10000, daysAgo: 20 });
  const { controller, transactions } = build({ startDate: START });
  createSplitsModel(db).setRefunded('link', String(link.id), 1000);
  transactions.upsertMany([mollieCredit('c1', 7000, 15, { reference: 'REF T19274230.2611.12' }), mollieCredit('c2', 2000, 1, { reference: 'REF T19274230.2611.13' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 7000 }], user: { id: 1 } });
  controller.confirm({ transactionId: 'c2', allocations: [{ reservationId, ledgerKey: 'balance#retenue', amountCents: 2000 }], user: { id: 1 } });
  const found = controller.journal(window(-20, 0));
  assert.equal(found.entries.find((e) => e.kind === 'link').amountCents, 9000);
  assert.equal(found.clearing.balanceCents, 0);
});

test('rule 5 — the costs of a settlement that holds an unknown payment are split: the known share is booked, the rest is shown apart', () => {
  const { reservationId, link } = paidStay({ cents: 10000, daysAgo: 20 });
  createSettlementsModel(db).store({ id: 'stl_m', reference: '19274230.2611.14', settledAt: null, amountCents: 9900, costsCents: 100, reserveHeldCents: 0, reserveReleasedCents: 0, source: 'balance' }, [
    { id: 'tr_known', kind: 'immediate', amountCents: 8000, splitId: `link:${link.id}` },
    { id: 'tr_other', kind: 'immediate', amountCents: 2000, splitId: null },
  ]);
  const { controller, transactions } = build({ startDate: START });
  transactions.upsertMany([mollieCredit('c1', 8000, 15, { reference: 'REF T19274230.2611.14' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 8000 }], user: { id: 1 } });
  const found = controller.journal(window(-20, 0));
  assert.deepEqual(found.entries.filter((e) => e.kind === 'cost').map((e) => e.amountCents), [80]);
  assert.deepEqual(found.unattached.filter((u) => u.kind === 'cost').map((u) => u.amountCents), [20]);
});

test('rule 28 — a link paid at 23:30 UTC is booked on the Paris day, whatever the stored format of the instant', () => {
  const stay = paidStay({ cents: 10000, daysAgo: 30 });
  const { controller } = build({ startDate: START });
  const link = () => controller.journal(window(-31, -28)).entries.find((e) => e.kind === 'link');
  assert.equal(link().date, dayAt(-30), 'paid at 10:00 UTC: the same day');
  db.prepare('UPDATE payment_links SET paidAt = ? WHERE id = ?').run(`${dayAt(-30)}T23:30:00Z`, stay.link.id);
  db.prepare('DELETE FROM mollie_payment_splits').run();
  controller.syncSplits();
  assert.equal(link().date, dayAt(-29), 'ISO instant with a zone');
  db.prepare('UPDATE payment_links SET paidAt = ? WHERE id = ?').run(`${dayAt(-30)} 23:30:00`, stay.link.id);
  db.prepare('DELETE FROM mollie_payment_splits').run();
  controller.syncSplits();
  assert.equal(link().date, dayAt(-29), 'SQLite datetime(\'now\'), which is UTC without a zone');
});
