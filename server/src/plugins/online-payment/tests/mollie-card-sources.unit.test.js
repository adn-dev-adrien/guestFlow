// specs/mollie-rolling-reserve-and-incoming-payments.md rule 1 (second half) and rules 8, 16, 23, 28 — the card payments that
// go through Mollie WITHOUT a GuestFlow payment link: a Qonto invoice paid by card (the measured 14,00 € of client Gruat,
// invoice F-2026-013) and a card payment recorded on site from the date of « CB sur place via Mollie depuis ». Fictional
// data only, except the measured amounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../../sdk');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { buildModel } = require('../../../models/incomingPaymentsModel');
const { mollieDeclared } = require('../settingsStore');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { createSettlementsModel, syncSettlements } = require('../reconciliation/mollieSettlements');
const { invoiceSources } = require('../reconciliation/mollieCardSources');
const { db, TODAY, dayAt, addReservation, build, reset, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

const START = dayAt(-120);

/** A sale outside a stay, as the hourly-resources plugin lists it. */
const gruatSale = (over = {}) => ({
  key: 'resource-booking:41', date: dayAt(-11), totalCents: 1400, booksCents: 1400, cardCents: 1400, label: 'Bain nordique du 05/11',
  client: { firstName: 'Marc', lastName: 'Gruat' }, vatRate: 10, invoiceNumber: 'F-2026-013', ...over,
});
const provideSales = (sales) => createContext('hourly-resources', { db }).standaloneSales(() => sales);

/** A Mollie that answers one settlement with the given payments. */
const mollieAnswering = (payments, settlement = {}) => ({
  getSettlement: async (reference) => ({ id: 'stl_g1', reference, settledAt: `${dayAt(-7)}T08:00:00Z`, amountCents: 1120, costsCents: 0, reserveHeldCents: 0, reserveReleasedCents: 0, ...settlement }),
  listSettlementPayments: async () => payments,
});
const gruatPayment = () => ({ id: 'tr_gruat', amountCents: 1400, refundedCents: 0, description: 'F-2026-013', paidAt: `${dayAt(-11)}T16:10:00Z`, settlementId: 'stl_g1', paymentLinkId: null });

async function readSettlement(payments, credits) {
  return syncSettlements({
    client: mollieAnswering(payments), model: createSettlementsModel(db), splits: createSplitsModel(db), settings: { get: () => '' },
    credits, links: [], invoiceSources: invoiceSources(TODAY),
  });
}
const itemsOf = (controller) => ['todo', 'waiting', 'done'].flatMap((view) => controller.list({ view }).body.items);
const SALE_KEY = 'sale:resource-booking:41';

test('rule 1 — the measured Gruat case: 14,00 € paid on invoice F-2026-013 is split in 11,20 € now and 2,80 € held, paired exactly with its Mollie payment', async () => {
  provideSales([gruatSale()]);
  const { controller, transactions } = build({ startDate: START });
  const credits = [mollieCredit('c1', 1120, 7, { reference: 'REF T19274230.2611.01' })];
  transactions.upsertMany(credits, { bankAccountId: 'acc-1' });
  assert.deepEqual(itemsOf(controller).filter((i) => i.mollie), [], 'no Mollie token read yet: nothing is known of this payment');

  assert.deepEqual(await readSettlement([gruatPayment()], credits), { read: 1, unknownPayments: 0, balances: false, failed: [] });
  const stored = createSplitsModel(db).forSource('invoice', 'F-2026-013');
  assert.deepEqual([stored.grossCents, stored.immediateCents, stored.reserveCents, stored.molliePaymentId, stored.reservationId, stored.ledgerKey],
    [1400, 1120, 280, 'tr_gruat', null, SALE_KEY]);

  const items = itemsOf(controller).filter((i) => i.mollie);
  const immediate = items.find((i) => i.ledgerKey === `${SALE_KEY}#immediat`);
  const reserve = items.find((i) => i.ledgerKey === `${SALE_KEY}#retenue`);
  assert.deepEqual([immediate.expectedCents, reserve.expectedCents], [1120, 280]);
  assert.equal(immediate.expectedDate, dayAt(-11 + 4), 'paid + 4 days');
  assert.equal(reserve.expectedDate, dayAt(-11 + 4 + 90));
  assert.deepEqual([immediate.reservation.id, immediate.reservation.saleKey, immediate.reservation.clientName], [null, 'resource-booking:41', 'Marc Gruat']);
  assert.equal(immediate.proposal.confidence, 'sur', 'the settlement names the payment: exact');
  assert.match(immediate.proposal.reason, /19274230\.2611\.01/);

  const confirmed = controller.confirm({ transactionId: 'c1', allocations: [{ reservationId: 0, ledgerKey: `${SALE_KEY}#immediat`, amountCents: 1120 }], user: { id: 1 } });
  assert.equal(confirmed.status, 201);
  const after = itemsOf(controller).filter((i) => i.mollie);
  assert.equal(after.find((i) => i.ledgerKey === `${SALE_KEY}#immediat`).state, 'reconciled');
  assert.equal(after.find((i) => i.ledgerKey === `${SALE_KEY}#retenue`).expectedDate, dayAt(-7 + 90), 'the reserve counts from the real bank date');
});

test('rule 16 — a Mollie payment paired by its invoice number corrects an on-site estimate to the exact gross and date, with the rate it already carries', async () => {
  provideSales([gruatSale({ cardCents: 1300 })]);
  const { controller } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  controller.syncSplits();
  const estimate = createSplitsModel(db).forSource('invoice', 'F-2026-013');
  assert.deepEqual([estimate.grossCents, estimate.molliePaymentId], [1300, null]);
  await readSettlement([gruatPayment()], [mollieCredit('c1', 1120, 7, { reference: 'REF T19274230.2611.01' })]);
  const exact = createSplitsModel(db).forSource('invoice', 'F-2026-013');
  assert.deepEqual([exact.grossCents, exact.immediateCents, exact.reserveCents, exact.molliePaymentId], [1400, 1120, 280, 'tr_gruat']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mollie_payment_splits WHERE sourceType = 'invoice'").get().n, 1, 'one record, one split');
});

function cardInstallmentStay(paidDay) {
  const id = addReservation({ finalPrice: 400, depositAmount: 0, balanceAmount: 0 });
  const model = sdk.coreModule('installmentsModel').buildModel(db);
  model.replacePlan(id, [{ number: 1, dueDate: paidDay, amountCents: 20000 }, { number: 2, dueDate: dayAt(20), amountCents: 20000 }], 40000);
  model.markPaid(model.listFor(id)[0].id, { paidDate: paidDay, method: 'card' });
  return id;
}

test('rule 1 — a card payment of an instalment recorded from the setting date is split in two tranches; the ledger shows them under its échéance', () => {
  const id = cardInstallmentStay(dayAt(-10));
  const { controller } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  const keys = itemsOf(controller).filter((i) => i.reservation.id === id).map((i) => i.ledgerKey).sort();
  assert.deepEqual(keys, ['installment-1#immediat', 'installment-1#retenue', 'installment-2']);
  const split = createSplitsModel(db).forSource('tender', `installment:${db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? AND number = 1').get(id).id}`);
  assert.deepEqual([split.immediateCents, split.reserveCents, split.reservationId, split.ledgerKey], [16000, 4000, id, 'installment-1']);
  const tranches = controller.ledgerTranches(id);
  assert.deepEqual(Object.keys(tranches.rows), ['installment-1']);
  assert.deepEqual(tranches.rows['installment-1'].map((t) => t.amountCents), [16000, 4000]);
  assert.equal(tranches.schedule.expectedCents, 20000);
});

test('rule 1 — before the setting date (or with the setting empty) a card payment is unchanged: one receipt, expected in the day\'s card batch', () => {
  const id = cardInstallmentStay(dayAt(-40));
  const before = build({ startDate: dayAt(-60), settings: { mollieCardOnSiteSince: dayAt(-30) } });
  const unchanged = itemsOf(before.controller).filter((i) => i.reservation.id === id);
  assert.deepEqual(unchanged.map((i) => [i.ledgerKey, i.expectedCents, Boolean(i.mollie)]), [['installment-1', 20000, false], ['installment-2', 20000, false]]);
  const off = build({ startDate: dayAt(-60) });
  assert.deepEqual(itemsOf(off.controller).filter((i) => i.reservation.id === id).map((i) => i.ledgerKey), ['installment-1', 'installment-2']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mollie_payment_splits').get().n, 0);
});

test('rule 1 — a sale outside a stay with no invoice is split from the setting date on, and leaves the day\'s card batch', () => {
  provideSales([gruatSale({ key: 'resource-booking:7', invoiceNumber: null, date: dayAt(-12) })]);
  const { controller, transactions } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  const stored = (() => { controller.syncSplits(); return createSplitsModel(db).forSource('tender', 'sale:resource-booking:7'); })();
  assert.equal(stored.immediateCents, 1120);
  const stay = addReservation({ finalPrice: 40, depositAmount: 0, balanceAmount: 40, balancePaid: 1, balancePaidDate: dayAt(-12), startDate: dayAt(-20), endDate: dayAt(-18) });
  transactions.upsertMany([{
    id: 'batch', amountCents: 4000, currency: 'EUR', settledAt: `${dayAt(-12)}T08:00:00.000Z`, operationType: 'income', label: 'Paiements facturés',
    counterpartyName: 'Paiements facturés', reference: `Paiements-En-Personne-${dayAt(-12).split('-').reverse().join('-')}`,
  }], { bankAccountId: 'acc-1' });
  const item = itemsOf(controller).find((i) => i.reservation.id === stay && i.ledgerKey === 'balance');
  assert.ok(item.proposal, 'the fiche alone makes the batch: the sale is not in it');
  assert.equal(item.proposal.source, 'card-batch');
  assert.doesNotMatch(item.proposal.reason, /hors séjour/);
});

test('rule 3 — « CB sur place via Mollie depuis » is a real day that is not in the future; empty means off', () => {
  const validate = (value) => mollieDeclared().find((d) => d.key === 'mollieCardOnSiteSince').validate(value);
  assert.equal(validate(dayAt(-30)), null);
  assert.equal(validate(''), null, 'empty = off');
  assert.equal(validate(TODAY), null);
  assert.equal(validate(dayAt(2)), 'La date doit être un jour valide qui n\'est pas dans le futur');
  assert.ok(validate('05/11/2026'));
  assert.ok(validate('2026-02-30'));
});

test('rule 23 — a sale outside a stay is a sum to arrive grouped under its client, or under its label when it names none', () => {
  provideSales([gruatSale(), gruatSale({ key: 'resource-booking:42', invoiceNumber: null, client: { firstName: '', lastName: '' }, label: 'Bain nordique du 06/11', date: dayAt(-2) })]);
  const { controller } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  createContext('online-payment', { db }).incomingPayments(({ recent }) => controller.incomingItems({ recent }));
  const out = buildModel(db).get({ today: TODAY });
  const names = out.clients.map((c) => c.name).sort();
  assert.deepEqual(names, ['Bain nordique du 06/11', 'Marc Gruat']);
  const gruat = out.clients.find((c) => c.name === 'Marc Gruat');
  assert.deepEqual([gruat.clientId, gruat.stays[0].reservationId, gruat.stays[0].saleKey], [null, null, 'resource-booking:41']);
  assert.deepEqual(gruat.stays[0].items.map((i) => [i.kind, i.amountCents]).sort(), [['mollieReserve', 280], ['mollieTransit', 1120]]);
  assert.equal(out.totals.amountCents, 1400 + 1400);
});

test('rule 13 — the late reserve of a sale outside a stay raises its own attention item, named by the sale, with no fiche', () => {
  provideSales([gruatSale({ date: dayAt(-150) })]);
  const { controller } = build({ startDate: dayAt(-200), settings: { mollieCardOnSiteSince: dayAt(-160), reconciliationStartDate: dayAt(-200) } });
  const { items, count } = controller.reserveAttention();
  assert.equal(count, 1);
  assert.deepEqual([items[0].reservationId, items[0].saleKey, items[0].clientName, items[0].amountCents], [null, 'resource-booking:41', 'Marc Gruat', 280]);
});

test('rule 28 — the sale outside a stay books like a link: a link-like entry for the gross on its payment day, a credit entry on the bank day, and the clearing balance is what Mollie still holds', async () => {
  provideSales([gruatSale()]);
  const { controller, transactions } = build({ startDate: START });
  const credits = [mollieCredit('c1', 1120, 7, { reference: 'REF T19274230.2611.01' })];
  transactions.upsertMany(credits, { bankAccountId: 'acc-1' });
  await readSettlement([gruatPayment()], credits);
  controller.confirm({ transactionId: 'c1', allocations: [{ reservationId: 0, ledgerKey: `${SALE_KEY}#immediat`, amountCents: 1120 }], user: { id: 1 } });

  const found = controller.journal({ from: dayAt(-30), to: dayAt(0) });
  const link = found.entries.find((e) => e.kind === 'link');
  assert.deepEqual([link.date, link.amountCents, link.reservationId, link.client.lastName], [dayAt(-11), 1400, null, 'Gruat']);
  assert.equal(found.entries.find((e) => e.kind === 'credit').amountCents, 1120);
  assert.deepEqual([found.clearing.balanceCents, found.clearing.clients.length, found.clearing.clients[0].saleKey, found.clearing.clients[0].balanceCents], [280, 1, 'resource-booking:41', 280]);

  // The export turns each fact into two equal lines (D clearing / C client for a link, D bank / C clearing for a credit:
  // accounting-mollie-journal.unit.test.js), so the entries balance by construction and the clearing balance is their difference.
  const booked = (kind) => found.entries.filter((e) => e.kind === kind).reduce((t, e) => t + e.amountCents, 0);
  assert.equal(booked('link') - booked('credit'), found.clearing.balanceCents, 'what Mollie still holds');
  assert.equal(found.entries.find((e) => e.kind === 'link').libelle, 'Marc Gruat');
});

test('rule 1 — the CB line of a split payment goes through Mollie, its cheque line stays a receipt of its own; the tranches sit under the row it paid', () => {
  const id = addReservation({ depositAmount: 0, balanceAmount: 0, finalPrice: 500, endOfStayComplementAmount: 122, endOfStayComplementPaid: 1, endOfStayComplementPaidDate: dayAt(-3) });
  require('../../../models/paymentSettlementsModel').insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'endOfStayComplement', paidDate: dayAt(-3), dueCents: 12200,
    parts: [{ kind: 'endOfStayComplement', key: 'endOfStayComplement', amountCents: 12200 }],
    lines: [{ method: 'cheque', amountCents: 5000, internal: false }, { method: 'card', amountCents: 7200, internal: false }],
  });
  const settlement = db.prepare('SELECT id FROM payment_settlements WHERE reservationId = ?').get(id);
  const { controller } = build({ startDate: START, settings: { mollieCardOnSiteSince: dayAt(-30) } });
  const mine = itemsOf(controller).filter((i) => i.reservation.id === id).map((i) => [i.ledgerKey, i.expectedCents]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(mine, [
    [`settlement-${settlement.id}`, 5000], [`settlement-${settlement.id}-card#immediat`, 5760], [`settlement-${settlement.id}-card#retenue`, 1440],
  ]);
  assert.deepEqual(Object.keys(controller.ledgerTranches(id).rows), ['endOfStayComplement']);
});
