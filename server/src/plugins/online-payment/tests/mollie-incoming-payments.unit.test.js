// specs/mollie-rolling-reserve-and-incoming-payments.md rules 23-25 — the Mollie kinds of « Versements à venir »: the reserve
// Mollie holds, and the immediate share still in transit; once received, the same tranches are the « Reçus récemment » with
// the identifiers of their credit. Contributed by the plugin through `ctx.incomingPayments`, gathered by the core.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { buildModel } = require('../../../models/incomingPaymentsModel');
const { db, TODAY, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

function wire(options) {
  const built = build({ startDate: dayAt(-120), ...options });
  createContext('online-payment', { db }).incomingPayments(({ recent }) => built.controller.incomingItems({ recent }));
  return built;
}
const linesOf = (out) => out.clients.flatMap((c) => c.stays.flatMap((s) => s.items));

test('rule 23 — a paid link is two sums to arrive: « Mollie en transit » (the immediate share) and « Retenue Mollie »', () => {
  const { reservationId } = paidStay({ cents: 73240, daysAgo: 2 });
  wire();
  const out = buildModel(db).get({ today: TODAY });
  assert.deepEqual(out.kinds, [{ key: 'mollieReserve', label: 'Retenue Mollie', count: 1 }, { key: 'mollieTransit', label: 'Mollie en transit', count: 1 }]);
  const [transit, reserve] = linesOf(out);
  assert.equal(transit.natureLabel, 'Paiement carte · 80 %');
  assert.equal(transit.amountCents, 58592);
  assert.equal(transit.expectedDate, dayAt(2));
  assert.equal(transit.stateLabel, 'Dans 2 jours');
  assert.equal(reserve.natureLabel, 'Retenue Mollie');
  assert.equal(reserve.natureDetail, '20 % retenus pendant 90 jours · Solde');
  assert.equal(reserve.amountCents, 14648);
  assert.equal(reserve.expectedDate, dayAt(-2 + 4 + 90));
  assert.equal(reserve.stateLabel, 'Dans 3 mois');
  assert.equal(reserve.icon, 'hourglass');
  assert.equal(transit.icon, 'card');
  assert.equal(out.clients[0].stays[0].reservationId, reservationId);
  assert.equal(out.totals.amountCents, 73240, 'what Mollie still owes: the whole payment');
  assert.equal(out.totals.nextDate, dayAt(2));
});

test('rule 23 — a tranche past its window is red and sorts first; the reserve counts from the immediate share\'s real bank date', () => {
  const late = paidStay({ cents: 10000, daysAgo: 30 });
  const reserve = paidStay({ cents: 10000, daysAgo: 100, clientId: 2 });
  const { transactions, controller } = wire();
  transactions.upsertMany([mollieCredit('r1', 8000, 95)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'r1', allocations: [{ reservationId: reserve.reservationId, ledgerKey: 'balance#immediat', amountCents: 8000 }], user: { id: 1 } });
  const out = buildModel(db).get({ today: TODAY });
  assert.equal(out.clients[0].late, true);
  const first = out.clients[0].stays[0].items[0];
  assert.deepEqual([first.state, first.stateLabel], ['late', 'En retard de 26 j']);
  assert.equal(out.clients[0].stays[0].reservationId, late.reservationId);
  const second = out.clients.find((c) => c.stays[0].reservationId === reserve.reservationId).stays[0].items[0];
  assert.equal(second.kind, 'mollieReserve');
  assert.equal(second.expectedDate, dayAt(-95 + 90), 'the immediate credit\'s bank date + 90 days');
  assert.deepEqual([second.state, second.stateLabel], ['upcoming', 'Attendu depuis 5 j'], 'five days past its date, ten days of window: not late yet');
});

test('rule 24 — « Reçus récemment »: the received tranche, its bank date and the identifiers of its credit', () => {
  const { reservationId } = paidStay({ cents: 73240, daysAgo: 6 });
  const { transactions, controller } = wire();
  transactions.upsertMany([mollieCredit('c1', 58592, 3, { reference: 'REF T19274230.2610.01', transactionId: 'solio-6791-1-transaction-019d-0007' })], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 58592 }], user: { id: 1 } });
  const pending = linesOf(buildModel(db).get({ today: TODAY }));
  assert.deepEqual(pending.map((l) => l.kind), ['mollieReserve'], 'the received share leaves the table');
  const recent = linesOf(buildModel(db).get({ today: TODAY, recent: true }));
  assert.equal(recent.length, 1);
  const [received] = recent;
  assert.equal(received.state, 'received');
  assert.equal(received.receivedDate, dayAt(-3));
  assert.equal(received.stateLabel, `Reçu le ${dayAt(-3).slice(8, 10)}/${dayAt(-3).slice(5, 7)}`);
  assert.deepEqual(received.refs, { qonto: 'solio-6791-1-transaction-019d-0007', mollieSettlement: 'T19274230.2610.01', molliePayment: null });
});

test('rule 24 — a credit older than 30 days is not « récent »', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 60 });
  const { transactions, controller } = wire();
  transactions.upsertMany([mollieCredit('c1', 8000, 55)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId, ledgerKey: 'balance#immediat', amountCents: 8000 }], user: { id: 1 } });
  assert.deepEqual(linesOf(buildModel(db).get({ today: TODAY, recent: true })), []);
});

test('rule 25 — without a Qonto connection or a start date the plugin offers nothing: the Mollie kinds are absent', () => {
  paidStay({ cents: 10000, daysAgo: 2 });
  const off = build({ connected: false });
  assert.deepEqual(off.controller.incomingItems({}), []);
  assert.deepEqual(off.controller.journal({ from: dayAt(-30), to: dayAt(0) }), { entries: [], unattached: [], clearing: null });
  assert.equal(off.controller.ledgerTranches(1), null);
});
