// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 13, 18, 19, 23 — « en retard » means the same everywhere (the
// reconciliation item, the payments ledger, « Versements à venir »), a proposal waiting for a click does not hide it, the
// recap line tells the tranches apart, the labels derive their share from what was kept, the home alert has its line, and a
// future reserve is listed under « Attendus ». Fictional data, dates relative to today.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const paymentLinks = require('../../../models/paymentLinksModel');
const { stateOf } = require('../../../utils/incomingPayments');
const { createSettlementsModel } = require('../reconciliation/mollieSettlements');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { buildRouter } = require('../reconciliation/routes');
const reservationsController = require('../../../controllers/reservationsController');
const { db, TODAY, dayAt, build, reset, paidStay, mollieCredit } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

const START = dayAt(-140);
const frShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const frLong = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fiche = (id) => {
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  reservationsController.getById({ params: { id: String(id) }, user: { role: 'admin' } }, res);
  return res.body;
};
const wire = () => {
  const built = build({ startDate: START });
  createContext('online-payment', { db }).ledgerBankTranches(({ reservationId }) => built.controller.ledgerTranches(reservationId));
  return built;
};

test('rules 13 and 23 — an immediate share past its window is late everywhere, even while a proposal waits for the operator', () => {
  const { reservationId, link } = paidStay({ cents: 10000, daysAgo: 17 });
  createSettlementsModel(db).store({ id: 'stl_l', reference: '19274230.2611.21', settledAt: null, amountCents: 8000, costsCents: 0, reserveHeldCents: 2000, reserveReleasedCents: 0, source: 'balance' },
    [{ id: 'tr_l', kind: 'immediate', amountCents: 8000, splitId: `link:${link.id}` }]);
  const { controller, transactions } = wire();
  transactions.upsertMany([mollieCredit('c1', 8000, 2, { reference: 'REF T19274230.2611.21' })], { bankAccountId: 'acc-1' });

  const item = ['todo', 'waiting'].flatMap((view) => controller.list({ view }).body.items).find((i) => i.ledgerKey === 'balance#immediat');
  assert.equal(item.state, 'proposed', 'the operator still has to click');
  assert.deepEqual([item.mollie.late, item.mollie.daysLate], [true, 13], 'but the reconciliation item says it is late, 13 days after its expected date');

  const incoming = controller.incomingItems({}).find((i) => i.kind === 'mollieTransit');
  assert.equal(incoming.late, true);
  assert.equal(stateOf(incoming, TODAY).stateLabel, 'En retard de 13 j');

  const tranche = fiche(reservationId).ledger.rows.find((r) => r.key === 'balance').bankTranches[0];
  assert.deepEqual([tranche.state, tranche.tone, tranche.stateLabel], ['late', 'error', 'en retard de 13 j']);
});

test('rule 19 — the recap line tells the immediate share from the reserve, and the late share from both', () => {
  const onTime = paidStay({ cents: 73240, daysAgo: 2 });
  const late = paidStay({ cents: 73240, daysAgo: 17, clientId: 2 });
  wire();
  const soon = fiche(onTime.reservationId).ledger.schedule;
  assert.equal(soon.text, `Payé par carte 732,40 € — 585,92 € attendus le ${frShort(dayAt(-2 + 4))} · 146,48 € retenus jusqu'au ${frLong(dayAt(-2 + 94))}`);
  assert.deepEqual(soon.segments.map((s) => s.tone), ['default', 'muted', 'muted']);
  const overdue = fiche(late.reservationId).ledger.schedule;
  assert.equal(overdue.text, `Payé par carte 732,40 € — 585,92 € en retard · 146,48 € retenus jusqu'au ${frLong(dayAt(-17 + 94))}`);
  assert.deepEqual([overdue.lateCents, overdue.heldCents, overdue.transitCents], [58592, 14648, 0]);
});

test('rule 18 — the percentages are what was kept of the payment, not the setting: a reserve Mollie held at 12,35 % reads 12,35 % and 87,65 %', () => {
  const { link } = paidStay({ cents: 10000, daysAgo: 5 });
  const { controller } = build({ startDate: START });
  createSplitsModel(db).correctReserve(`link:${link.id}`, 1235);
  const items = controller.incomingItems({});
  assert.equal(items.find((i) => i.kind === 'mollieReserve').natureDetail.startsWith('12,35 % retenus pendant 90 jours'), true);
  assert.equal(items.find((i) => i.kind === 'mollieTransit').natureLabel, 'Paiement carte · 87,65 %');
  assert.equal(controller.compute().items.find((i) => i.mollie.tranche === 'retenue').mollie.label, 'Retenue Mollie 12,35 %');
});

test('rule 13 — « Retenue Mollie non reçue » keeps the OLDEST expected date of a fiche, names its line, and is served by its own route', async () => {
  const stay = paidStay({ cents: 10000, daysAgo: 150 });
  db.prepare('UPDATE reservations SET depositAmount = 50, depositPaid = 1, depositPaidDate = ?, balanceAmount = 50 WHERE id = ?').run(dayAt(-130), stay.reservationId);
  const deposit = paymentLinks.create({ reservationId: stay.reservationId, type: 'deposit', amountCents: 5000, provider: 'qonto', providerLinkId: 'D1', url: 'u', status: 'open' });
  paymentLinks.markPaid(deposit.id, { providerPaymentId: 'pay-dep', paidAt: `${dayAt(-130)}T10:00:00Z` });
  const { controller } = build({ startDate: dayAt(-200) });
  const late = controller.compute().items.filter((i) => i.mollie && i.mollie.tranche === 'retenue' && i.mollie.late);
  assert.equal(late.length, 2, 'two reserves of one fiche are late');
  const { count, items } = controller.reserveAttention();
  assert.equal(count, 1, 'one item per fiche');
  const oldest = late.map((i) => i.expectedDate).sort()[0];
  assert.equal(items[0].expectedDate, oldest);
  assert.equal(items[0].expectedDateLabel, frShort(oldest));
  assert.equal(items[0].amountCents, 2000 + 1000);
  assert.equal(items[0].line, `Jean Dupont · 30,00 € · attendue le ${frShort(oldest)}`);
  assert.ok('saleLabel' in items[0]);

  const router = buildRouter({ reserveAttention: () => controller.reserveAttention() });
  const layer = router.stack.find((l) => l.route && l.route.path === '/reserve-attention');
  assert.ok(layer && layer.route.methods.get);
  const res = { body: null, code: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack[0].handle({}, res);
  assert.deepEqual([res.code, res.body.count], [200, 1]);
});

test('rule 8 — the reserve of a paid link is listed on the page under « Attendus » with its waiting state, like any future receipt; it is not a to-do', () => {
  const { reservationId } = paidStay({ cents: 10000, daysAgo: 5 });
  const { controller } = build({ startDate: START });
  const waiting = controller.list({ view: 'waiting' }).body.items.find((i) => i.reservation.id === reservationId && i.ledgerKey === 'balance#retenue');
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.stateLabel, 'Attendu');
  assert.ok(controller.list({ view: 'waiting' }).body.counts.waiting >= 2, 'the immediate share and the reserve are both expected');
  assert.equal(controller.list({ view: 'todo' }).body.items.some((i) => i.ledgerKey === 'balance#retenue'), false);
});

test('rule 23 — a client group of « Versements à venir » carries a unique key, and the tile a label for its next date', () => {
  const { buildIncoming } = require('../../../utils/incomingPayments');
  const stays = new Map([[1, { reservationId: 1, clientId: 5, clientName: 'A B', label: 'x', startDate: dayAt(-5), endDate: dayAt(-3) }]]);
  const out = buildIncoming({
    today: TODAY, stays, items: [{ key: 'k', kind: 'mollieReserve', kindLabel: 'Retenue', icon: 'hourglass', natureLabel: 'n', reservationId: 1, amountCents: 100, expectedDate: dayAt(3), late: false }],
  });
  assert.equal(out.clients[0].key, 'c5');
  assert.match(out.totals.nextDateLabel, /^\S+ \d{2}\/\d{2}$/);
});
