// specs/guest-app.md rules 72, 88 — a stay cancelled, superseded or deleted cancels its guest orders: status `cancelled`, stock and
// holds released, out of « À préparer »; a card-paid one is owed back, flagged « à rembourser » on its link.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, historyOf, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const CIDER = addOption({ id: 801, title: 'Cidre', price: 6 });
sell('option', CIDER);

function withStay(name, fn) {
  test(name, async () => {
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, card, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const cancelStay = (stayId, kind = 'cancelled') => db.prepare('UPDATE reservations SET kind = ? WHERE id = ?').run(kind, stayId);

async function payCard(call, card, quantity) {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity }], payment: 'card' });
  const { orderId } = res.body.data;
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(orderRow(orderId).paymentLinkId);
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
  return { orderId, link };
}

withStay('rule 72: a cancelled stay cancels its unpaid orders — never prepared, never billed; the guest reads them « Annulée »', async ({ stayId, call, api }) => {
  const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  const orderId = placed.body.data.orderId;
  cancelStay(stayId);
  const moved = api.cancelOrdersOf(stayId);
  assert.deepEqual(moved.map((o) => o.id), [orderId]);
  const row = orderRow(orderId);
  assert.deepEqual([row.status, row.cancelReason], ['cancelled', 'stay']);
  assert.ok(row.cancelledAt);
  assert.deepEqual(api.cancelOrdersOf(stayId), [], 'idempotent');
  cancelStay(stayId, 'reservation');
  const view = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  assert.deepEqual([view.status, view.statusLabel], ['cancelled', 'Annulée']);
  assert.equal((await call('GET', `/public/v1/guest/orders/${orderId}?lang=en`)).body.data.statusLabel, 'Cancelled');
});

withStay('rule 72: a live stay\'s orders are never touched by the event; the staff list drops the cancelled stay from « À préparer » and reads « Séjour annulé » under « Toutes »', async ({ stayId, call, api }) => {
  const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  assert.deepEqual(api.cancelOrdersOf(stayId), [], 'the stay is still a reservation');
  assert.equal(orderRow(placed.body.data.orderId).status, 'confirmed');
  cancelStay(stayId);
  const todo = (await call('GET', '/api/guest-app/orders')).body.orders.filter((o) => o.reservationId === stayId);
  assert.deepEqual(todo, []);
  api.cancelOrdersOf(stayId);
  const all = (await call('GET', '/api/guest-app/orders?status=all')).body.orders.find((o) => o.reservationId === stayId);
  assert.equal(all.statusLabel, 'Séjour annulé');
});

withStay('rule 72: the stock a cancelled order held comes back', async ({ stayId, call, api }) => {
  const WINE = addOption({ id: 802, title: 'Vin', price: 9 });
  sell('option', WINE);
  db.prepare('UPDATE guest_app_items SET stockTracked = 1, stockQuantity = 4 WHERE itemId = ?').run(WINE);
  assert.equal((await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WINE, quantity: 3 }], payment: 'note' })).status, 200);
  const left = async () => (await call('GET', '/public/v1/guest/shop')).body.data.categories.flatMap((c) => c.items).find((i) => i.id === WINE).stock.left;
  assert.equal(await left(), 1);
  cancelStay(stayId);
  api.cancelOrdersOf(stayId);
  cancelStay(stayId, 'reservation');
  assert.equal(await left(), 4);
});

withStay('rule 88: a card-paid order of a cancelled stay is cancelled and owed back — flagged « à rembourser » on its link, in the stay\'s history', async ({ stayId, call, card, api }) => {
  const { orderId, link } = await payCard(call, card, 3);
  assert.equal(orderRow(orderId).status, 'paid');
  cancelStay(stayId);
  api.cancelOrdersOf(stayId);
  assert.equal(orderRow(orderId).status, 'cancelled');
  const basket = JSON.parse(db.prepare('SELECT basketJson FROM payment_links WHERE id = ?').get(link.id).basketJson);
  assert.deepEqual([basket.refundOwed, basket.refundCents], [true, undefined], 'the whole payment is owed (18 €)');
  assert.ok(historyOf(stayId).some((c) => c.field === 'refundOwed' && /séjour annulé/.test(c.to)));
  const staff = (await call('GET', '/api/guest-app/orders?status=all')).body.orders.find((o) => o.id === orderId);
  assert.equal(staff.statusLabel, 'Payée · à rembourser');
  api.cancelOrdersOf(stayId);
  assert.equal(historyOf(stayId).filter((c) => c.field === 'refundOwed').length, 1, 'flagged once');
});
