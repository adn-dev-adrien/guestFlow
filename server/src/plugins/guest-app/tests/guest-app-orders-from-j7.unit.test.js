// specs/guest-app.md rules 65-69, 74, 76, 77, 85 (« Mon séjour » from J-7) — an order taken before the arrival, through the real
// routes and the core's own commit: the shop is open from J-7, the order is collected on the arrival complement, the card
// money is an arrival-moment note, the times offered are the stay's own, and what the stay holds is held until the arrival day.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, isoPlus, notesOf, openOrdering, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const CIDER = addOption({ id: 701, title: 'Cidre', price: 6 });
const WOOD = addOption({ id: 702, title: 'Panier de bois', price: 15, category: 'Autres' });
sell('option', CIDER);
sell('option', WOOD, { needsStaff: 1, leadMinutes: 30 });

function withJ7(name, fn, { stay = {}, card = false } = {}) {
  test(name, async () => {
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, ...stay });
    const provider = card ? fakeProvider() : null;
    const ctx = await openOrdering(stayId, { card: provider, guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, card: provider, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const stayRow = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);

withJ7('rules 65, 67: at J-5 the shop is open, « Régler à l’arrivée » and the card are both offered, the banner says when the service starts', async ({ call }) => {
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  assert.deepEqual([shop.open, shop.orderCollection, shop.noteLabel, shop.canPayNote], [true, 'arrival', 'Régler à l’arrivée', true]);
  assert.equal(shop.canPayCard, false, 'no provider live in this suite');
  assert.match(shop.preArrivalBanner, /^À partir de votre arrivée, le /);
  assert.equal((await call('GET', '/public/v1/guest/orders')).status, 200);
});

withJ7('rules 66, 76: a note order is collected at the arrival — on the arrival complement, « À régler à l’arrivée »', async ({ stayId, call }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = orderRow(res.body.data.orderId);
  assert.deepEqual([order.status, order.payment, order.collectAt, order.total], ['confirmed', 'note', 'arrival', 12]);
  assert.equal(stayRow(stayId).complementAmount, 12);
  assert.equal(stayRow(stayId).endOfStayComplementAmount, 0);
  const view = (await call('GET', `/public/v1/guest/orders/${order.id}`)).body.data;
  assert.deepEqual([view.collectAt, view.statusLabel], ['arrival', 'À régler à l’arrivée']);
  assert.equal((await call('GET', `/public/v1/guest/orders/${order.id}?lang=en`)).body.data.statusLabel, 'To pay on arrival');
});

withJ7('rule 68: a stay whose solde is still due orders on site — the shop reads the catalogue, the quote answers 409 ORDERS_OPEN_ON_ARRIVAL', async ({ call }) => {
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  assert.deepEqual([shop.open, shop.orderCollection, shop.closedReason], [false, 'unavailable', 'Pour ce séjour, les commandes ouvrent à votre arrivée.']);
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }] });
  assert.deepEqual([quote.status, quote.body.error.code], [409, 'ORDERS_OPEN_ON_ARRIVAL']);
}, { stay: { balancePaid: 0 } });

withJ7('rules 69, 77: the delivery times are the stay’s own — every stay day, never outside, arrival day from the check-in, departure day before the check-out; « Dès que possible » is not offered', async ({ call }) => {
  const picker = (await call('POST', '/public/v1/guest/shop/delivery-slots', { lines: [{ kind: 'option', id: WOOD }] })).body.data;
  assert.equal(picker.asap, null);
  assert.deepEqual(picker.days.map((d) => d.date), [isoPlus(5), isoPlus(6), isoPlus(7), isoPlus(8), isoPlus(9)]);
  const first = picker.days[0].times;
  assert.ok(first.length > 0 && first.every((t) => t.at.slice(11, 16) >= '16:00'), 'the arrival day opens at the check-in time');
  const last = picker.days[4].times;
  assert.ok(last.every((t) => t.at.slice(11, 16) < '10:00'), 'the departure day closes before the check-out time');
  assert.ok(picker.days.every((d) => d.available === d.times.length > 0), 'a day without a time is greyed');
});

withJ7('rule 69: a time before the check-in or after the check-out is refused, never moved into the stay', async ({ call, stayId }) => {
  const lines = [{ kind: 'option', id: WOOD, quantity: 1 }];
  const before = new Date(`${isoPlus(5)}T12:00:00+02:00`).toISOString();
  const after = new Date(`${isoPlus(9)}T12:00:00+02:00`).toISOString();
  for (const deliverAt of [before, after]) {
    const quote = await call('POST', '/public/v1/guest/orders/quote', { lines, deliverAt });
    assert.equal(quote.body.data.deliverAtUnavailable, true);
    const order = await call('POST', '/public/v1/guest/orders', { lines, deliverAt, payment: 'note' });
    assert.deepEqual([order.status, order.body.error.code], [409, 'DELIVERY_TIME_UNAVAILABLE']);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stayId).n, 0);
});

withJ7('rule 85: a card order before the arrival — paid, its money is an arrival-moment note, the arrival complement owes nothing, the order reads « Payée »', async ({ stayId, call, card }) => {
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  assert.equal(shop.canPayCard, true, 'card from J-7');
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 3 }], payment: 'card' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { orderId } = res.body.data;
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(orderRow(orderId).paymentLinkId);
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
  const order = orderRow(orderId);
  assert.deepEqual([order.status, order.collectAt], ['paid', 'arrival']);
  const notes = notesOf(stayId);
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].moment, notes[0].total], ['arrival', 18]);
  assert.equal(stayRow(stayId).complementAmount, 0, 'never collected again at the arrival');
  assert.equal((await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data.statusLabel, 'Payée');
}, { card: true });

withJ7('rule 74: an order taken before the arrival holds its units until the arrival day', async ({ call }) => {
  const WINE = addOption({ id: 703, title: 'Vin', price: 9 });
  sell('option', WINE);
  db.prepare('UPDATE guest_app_items SET stockTracked = 1, stockQuantity = 5 WHERE itemId = ?').run(WINE);
  const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WINE, quantity: 3 }], payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  assert.equal(shop.categories.flatMap((c) => c.items).find((i) => i.id === WINE).stock.left, 2, '5 - 3 held until the arrival day');
  const more = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WINE, quantity: 3 }], payment: 'note' });
  assert.deepEqual([more.status, more.body.error.code], [409, 'OUT_OF_STOCK']);
});
