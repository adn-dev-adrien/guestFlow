// specs/mollie-rolling-reserve-and-incoming-payments.md rules 1, 2, 8 — which payments are split and how a split follows its
// source: a complement link on the row the ledger draws, a card payment recorded on site corrected with the data (never with a
// setting), a basket link with no ledger row of its own. Fictional data, dates relative to today.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const paymentLinks = require('../../../models/paymentLinksModel');
const { db, dayAt, addReservation, build, reset, paidStay } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

const START = dayAt(-120);
const itemsOf = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);
let sales = [];
const sale = (over = {}) => ({
  key: 'resource-booking:9', date: dayAt(-10), totalCents: 1400, booksCents: 1400, cardCents: 1400, label: 'Bain nordique',
  client: { firstName: 'Marc', lastName: 'Gruat' }, vatRate: 10, invoiceNumber: null, ...over,
});
const provide = (list) => { sales = list; };
test.beforeEach(() => { sales = []; createContext('hourly-resources', { db }).standaloneSales(() => sales); });

test('rule 8 — a complement link deferred to the check-out is split on the row the ledger draws, « checkoutComplement »', () => {
  const stay = paidStay({
    cents: 10000, daysAgo: 20, type: 'complement', providerPaymentId: 'qonto-comp',
    stay: { balanceAmount: 0, balancePaid: 0, balancePaidDate: null, finalPrice: 100, complementAmount: 100, complementDeferredToCheckout: 1, complementPaid: 1, complementPaidDate: dayAt(-20) },
  });
  const { controller } = build({ startDate: START });
  const keys = itemsOf(controller).filter((i) => i.reservation.id === stay.reservationId).map((i) => i.ledgerKey).sort();
  assert.deepEqual(keys, ['checkoutComplement#immediat', 'checkoutComplement#retenue']);
  assert.deepEqual(Object.keys(controller.ledgerTranches(stay.reservationId).rows), ['checkoutComplement']);
});

test('rule 8 — a basket link is split, its tranches count in the fiche\'s schedule line and in the page, with no ledger row of their own', () => {
  const reservationId = addReservation({});
  const link = paymentLinks.create({
    reservationId, type: 'complement', amountCents: 5000, provider: 'qonto', providerLinkId: 'LB1', url: 'u', status: 'open',
    basket: { source: 'guest-app', lines: [] },
  });
  paymentLinks.markPaid(link.id, { providerPaymentId: 'pay-basket', paidAt: `${dayAt(-5)}T10:00:00Z` });
  const { controller } = build({ startDate: START });
  assert.deepEqual(itemsOf(controller).filter((i) => i.reservation.id === reservationId && i.mollie).map((i) => i.ledgerKey).sort(), [`basket-${link.id}#immediat`, `basket-${link.id}#retenue`]);
  const found = controller.ledgerTranches(reservationId);
  assert.deepEqual(found.rows, {}, 'no ledger row carries a basket');
  assert.equal(found.schedule.totalCents, 5000);
});

test('rule 1 — a card payment recorded on site follows the amount of its sale until Mollie\'s own payment is read, and leaves with it', () => {
  provide([sale()]);
  const { controller } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  const splits = createSplitsModel(db);
  assert.deepEqual([splits.forSource('tender', 'sale:resource-booking:9').grossCents, splits.forSource('tender', 'sale:resource-booking:9').immediateCents], [1400, 1120]);

  provide([sale({ cardCents: 2000, totalCents: 2000, booksCents: 2000 })]);
  controller.syncSplits();
  const corrected = splits.forSource('tender', 'sale:resource-booking:9');
  assert.deepEqual([corrected.grossCents, corrected.immediateCents, corrected.reserveCents], [2000, 1600, 400], 'rule 2 is about settings: the data corrects the estimate');
  assert.deepEqual(itemsOf(controller).filter((i) => i.mollie).map((i) => i.expectedCents).sort((a, b) => a - b), [400, 1600]);

  provide([sale({ cardCents: 0 })]);
  controller.syncSplits();
  assert.equal(splits.forSource('tender', 'sale:resource-booking:9'), null, 'the card payment is gone: so is its estimate');
  assert.deepEqual(itemsOf(controller).filter((i) => i.mollie), []);
});

test('rule 1 — an estimate that a bank line already rests on is kept when its card payment disappears', () => {
  provide([sale()]);
  const { controller, transactions } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  transactions.upsertMany([{
    id: 'c1', amountCents: 1120, currency: 'EUR', settledAt: `${dayAt(-6)}T08:00:00.000Z`, operationType: 'Transférer', label: 'Stichting Mollie Payments',
    counterpartyName: 'Stichting Mollie Payments', reference: 'REF T19274230.2611.04',
  }], { bankAccountId: 'acc-1' });
  assert.equal(controller.confirm({ transactionId: 'c1', allocations: [{ reservationId: 0, ledgerKey: 'sale:resource-booking:9#immediat', amountCents: 1120 }], user: { id: 1 } }).status, 201);
  provide([sale({ cardCents: 0 })]);
  controller.syncSplits();
  assert.ok(createSplitsModel(db).forSource('tender', 'sale:resource-booking:9'));
});

test('rule 1 — a Mollie payment that proves the card keeps the split even when the sale types another tender', () => {
  provide([sale({ invoiceNumber: 'F-2026-020' })]);
  const { controller } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  const splits = createSplitsModel(db);
  splits.fromMolliePayment({ sourceType: 'invoice', sourceKey: 'F-2026-020', reservationId: null, ledgerKey: 'sale:resource-booking:9' },
    { id: 'tr_1', amountCents: 1400, paidAt: `${dayAt(-10)}T10:00:00Z`, refundedCents: 0 }, { settings: { get: () => '' } });
  provide([sale({ invoiceNumber: 'F-2026-020', cardCents: 0 })]);
  controller.syncSplits();
  assert.ok(splits.forSource('invoice', 'F-2026-020'));
  assert.equal(itemsOf(controller).filter((i) => i.mollie).length, 2);
});

test('rule 6 — the split the data builds carries the refund in the journal: Mollie owes the gross less what it refunded', () => {
  const stay = paidStay({ cents: 10000, daysAgo: 20 });
  const { controller } = build({ startDate: START });
  createSplitsModel(db).setRefunded('link', String(stay.link.id), 1500);
  const link = controller.journal({ from: dayAt(-20), to: dayAt(-20) }).entries.find((e) => e.kind === 'link');
  assert.equal(link.amountCents, 8500);
});
