// specs/guest-app.md rules 37bis, 37ter, 37quater — the stock per article: a restock sets it, every sale counts when
// the article leaves the cellar (the app's orders in their commit, the website's and the staff's lines on the arrival
// day or when written later), unpaid card orders hold their units, « Épuisé » stops the app only, the staff is pushed
// once per threshold, and a late payment without its units is a conflict. On the app's database, stays around today.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, addBath, db, fakeProvider, isoPlus, openOrdering, optionLine, seedStay, sell,
} = fx;

let nextId = 600;
/** A fresh option sold in the app, tracked with `quantity` in stock. */
async function tracked(call, { quantity = 5, alertBelow = null, ...option } = {}) {
  nextId += 1;
  const id = addOption({ id: nextId, title: `Cidre ${nextId}`, price: 6, ...option });
  sell('option', id);
  const res = await call('PUT', `/api/guest-app/items/option/${id}`, { stockTracked: true, stockQuantity: quantity, stockAlertBelow: alertBelow });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return id;
}
const stockOf = (id) => db.prepare("SELECT stockQuantity FROM guest_app_items WHERE kind = 'option' AND itemId = ?").get(id).stockQuantity;
const addLine = (reservationId, optionId, quantity) => db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (?, ?, ?)').run(reservationId, optionId, quantity);
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

/** A payment the provider reports after the order expired: the poll runner's own path. */
function payLate(orderId, card) {
  const link = paymentLinksModel.findById(db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(orderId).paymentLinkId);
  card.pay(link.providerLinkId);
  return processPaidLink({
    ...buildPaymentEffectDeps(), link, paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
}
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

function withShop(name, fn, { card = false } = {}) {
  test(name, async () => {
    const stayId = seedStay();
    const provider = card ? fakeProvider() : null;
    const ctx = await openOrdering(stayId, { card: provider, guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, card: provider, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

withShop('rule 37bis: a restock sets the count with its history line; « Suivre le stock » needs a count; the bath and the breakfast have none', async ({ call }) => {
  const id = await tracked(call, { quantity: 24 });
  const view = (await call('GET', `/api/guest-app/items/option/${id}`)).body;
  assert.equal(view.stock.tracked, true);
  assert.equal(view.stock.quantity, 24);
  assert.match(view.stock.restockLine, /^Stock réglé à 24, \d{1,2} [a-zéû]+\.? \d{2}:\d{2}$/);
  nextId += 1;
  const bare = addOption({ id: nextId, title: 'Sans compte', price: 3 });
  assert.equal((await call('PUT', `/api/guest-app/items/option/${bare}`, { stockTracked: true })).status, 400);
  const bath = addBath({ id: 699 });
  const refused = await call('PUT', `/api/guest-app/items/resource/${bath}`, { stockTracked: true, stockQuantity: 3 });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'NO_STOCK');
  nextId += 1;
  const breakfast = addOption({ id: nextId, title: 'Petit-déjeuner', priceType: 'per_person_per_night', autoOptionType: 'breakfast' });
  assert.equal((await call('PUT', `/api/guest-app/items/option/${breakfast}`, { stockTracked: true, stockQuantity: 3 })).body.code, 'NO_STOCK');
});

withShop('rule 37quater: the shop says what is left, « Épuisé » once nothing is, and « En rupture » whatever the count', async ({ call }) => {
  const id = await tracked(call, { quantity: 2 });
  const itemOf = async () => (await call('GET', '/public/v1/guest/shop')).body.data.categories.flatMap((c) => c.items).find((i) => i.id === id);
  assert.deepEqual((await itemOf()).stock, { soldOut: false, left: 2, leftLabel: 'Plus que 2' });
  await call('PUT', `/api/guest-app/items/option/${id}`, { soldOut: true });
  assert.deepEqual((await itemOf()).stock, { soldOut: true, left: 0, leftLabel: null });
  await call('PUT', `/api/guest-app/items/option/${id}`, { soldOut: false, stockQuantity: 40 });
  assert.deepEqual((await itemOf()).stock, { soldOut: false, left: 40, leftLabel: null }, 'more than a full order: no label');
});

withShop('rule 37bis: « En rupture » stops the app on an article whose stock is not followed, and an order of it is refused', async ({ call }) => {
  nextId += 1;
  const id = addOption({ id: nextId, title: `Jus ${nextId}`, price: 4 });
  sell('option', id);
  const itemOf = async () => (await call('GET', '/public/v1/guest/shop')).body.data.categories.flatMap((c) => c.items).find((i) => i.id === id);
  assert.equal((await itemOf()).stock, undefined, 'not followed, not sold out: never limited');
  assert.equal((await call('PUT', `/api/guest-app/items/option/${id}`, { soldOut: true })).status, 200);
  assert.deepEqual((await itemOf()).stock, { soldOut: true, left: 0, leftLabel: null });
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 1 }], payment: 'note' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'OUT_OF_STOCK');
  assert.equal(res.body.error.details.left, 0);
  assert.equal((await call('PUT', `/api/guest-app/items/option/${id}`, { soldOut: false })).status, 200);
  assert.equal((await itemOf()).stock, undefined);
});

withShop('rule 37quater: beyond what is left, the quote says « Plus que 2 disponibles » and the order answers 409 OUT_OF_STOCK with the units left', async ({ call, stayId }) => {
  const id = await tracked(call, { quantity: 2 });
  const quote = (await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'option', id, quantity: 3 }] })).body.data;
  assert.deepEqual(quote.lines[0].outOfStock, { left: 2, label: 'Plus que 2 disponibles' });
  assert.equal(quote.lines[0].unavailable, true);
  assert.equal(quote.total, 0);
  const order = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 3 }], payment: 'note' });
  assert.equal(order.status, 409);
  assert.equal(order.body.error.code, 'OUT_OF_STOCK');
  assert.equal(order.body.error.details.itemKey, `option:${id}`);
  assert.equal(order.body.error.details.left, 2);
  assert.equal(optionLine(stayId, id), undefined, 'nothing reached the fiche');
  assert.equal((await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 2 }], payment: 'note' })).status, 200);
  assert.equal(stockOf(id), 0);
  const after = (await call('GET', `/api/guest-app/items/option/${id}`)).body.stock;
  assert.equal(after.quantity, 0);
  assert.match(after.restockLine, /^Stock réglé à 2, /, 'the restock line keeps the count set, not what is left');
});

withShop('rule 37ter: an app order counts in its commit, and the reservation event that follows finds nothing left to count', async ({ call, api, stayId }) => {
  const id = await tracked(call, { quantity: 10 });
  await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 3 }], payment: 'note' });
  assert.equal(optionLine(stayId, id).quantity, 3);
  assert.equal(stockOf(id), 7);
  api.reconcileStock(stayId);
  api.reconcileStock(stayId);
  assert.equal(stockOf(id), 7, 'not counted twice');
});

withShop('rule 37ter: a per-person article counts the people it serves — ×4 takes 4, the fiche’s one line of 4 persons included', async ({ call, api, stayId }) => {
  const id = await tracked(call, { quantity: 10, priceType: 'per_person' });
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 4 }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([optionLine(stayId, id).quantity, optionLine(stayId, id).cardPersons], [1, 4]);
  assert.equal(stockOf(id), 6);
  api.reconcileStock(stayId);
  assert.equal(stockOf(id), 6, 'the event that follows agrees with the order');
});

withShop('rule 37ter: a site line counts on the arrival day, not before; a line added mid-stay at once; lowered or cancelled after arrival it returns', async ({ call, api, stayId }) => {
  const id = await tracked(call, { quantity: 10 });
  const future = seedStay({ start: 5, end: 8 });
  addLine(future, id, 2);
  api.reconcileStock(future);
  assert.equal(stockOf(id), 10, 'a stay to come takes nothing yet');
  db.prepare('UPDATE reservations SET kind = ? WHERE id = ?').run('cancelled', future);
  api.reconcileStock(future);
  assert.equal(stockOf(id), 10, 'cancelled before its arrival: it never counted');
  addLine(stayId, id, 4);
  api.reconcileStock(stayId);
  assert.equal(stockOf(id), 6, 'a stay in progress counts its line when it is written');
  db.prepare('UPDATE reservation_options SET quantity = 1 WHERE reservationId = ? AND optionId = ?').run(stayId, id);
  api.reconcileStock(stayId);
  assert.equal(stockOf(id), 9, 'lowered: three back');
  db.prepare('UPDATE reservations SET kind = ? WHERE id = ?').run('cancelled', stayId);
  api.reconcileStock(stayId);
  assert.equal(stockOf(id), 10, 'cancelled after arrival: all back');
});

withShop('rule 37ter: the arrival sweep counts the stays that reached their start date; the staff and the site are never refused, the stock goes below 0', async ({ call, api }) => {
  const id = await tracked(call, { quantity: 1 });
  const today = seedStay({ start: 0, end: 2 });
  addLine(today, id, 3);
  api.sweepStock();
  assert.equal(stockOf(id), -2);
  assert.equal((await call('GET', `/api/guest-app/items/option/${id}`)).body.stock.quantityLabel, '−2');
  const warning = (await call('GET', '/api/guest-app/stock')).body.items.find((i) => i.id === id);
  assert.equal(warning.label, 'Stock : épuisé');
  db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(today);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(today);
  api.sweepStock();
  assert.equal(stockOf(id), 1, 'a deleted stay gives back what it took');
});

withShop('rule 37bis: a restock is what the cellar holds now — what the stays took before is not taken again', async ({ call, api }) => {
  const id = await tracked(call, { quantity: 10 });
  const running = seedStay({ start: -1, end: 3 });
  addLine(running, id, 4);
  api.reconcileStock(running);
  assert.equal(stockOf(id), 6);
  await call('PUT', `/api/guest-app/items/option/${id}`, { stockQuantity: 24 });
  api.reconcileStock(running);
  assert.equal(stockOf(id), 24);
});

withShop('rule 37quater: « Stock bas » once the threshold is reached, « épuisé » once at 0, each once until the next restock', async ({ call, pushes }) => {
  const id = await tracked(call, { quantity: 5, alertBelow: 3 });
  const order = (quantity) => call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity }], payment: 'note' });
  const stockPushes = () => pushes.filter((p) => /Stock|épuisé/.test(p.payload.title));
  await order(2);
  await tick();
  assert.deepEqual(stockPushes().map((p) => p.payload.body), [`Stock bas : Cidre ${id} — plus que 3`]);
  await order(1);
  await tick();
  assert.equal(stockPushes().length, 1);
  await order(2);
  await tick();
  assert.deepEqual(stockPushes().map((p) => p.payload.body).slice(1), [`Cidre ${id} épuisé`]);
  assert.equal(stockPushes()[1].payload.title, 'Stock épuisé');
  await call('PUT', `/api/guest-app/items/option/${id}`, { stockQuantity: 4 });
  await order(1);
  await tick();
  assert.equal(stockPushes().length, 3, 'a restock re-arms the threshold');
});

withShop('rule 37ter (reading of 2026-11-13): an unpaid card order holds no units — the stock counts only once it is paid', async ({ call, api, card, clock, stayId }) => {
  const id = await tracked(call, { quantity: 3 });
  const leftOf = async () => (await call('GET', `/api/guest-app/items/option/${id}`)).body.stock;
  const first = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 2 }], payment: 'card' })).body.data;
  assert.deepEqual([(await leftOf()).held, (await leftOf()).left], [0, 3]);
  assert.equal((await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'option', id, quantity: 3 }] })).body.data.lines[0].outOfStock, undefined);
  await call('POST', `/public/v1/guest/orders/${first.orderId}/abandon`);
  assert.equal((await leftOf()).left, 3);
  const second = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 1 }], payment: 'card' })).body.data;
  clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
  api.expireOrders();
  assert.equal((await leftOf()).left, 3, 'expired: released');
  const third = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 2 }], payment: 'card' })).body.data;
  const linkId = db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(third.orderId).paymentLinkId;
  card.pay(db.prepare('SELECT providerLinkId FROM payment_links WHERE id = ?').get(linkId).providerLinkId);
  assert.equal((await call('GET', `/public/v1/guest/orders/${third.orderId}`)).body.data.status, 'paid');
  assert.equal(optionLine(stayId, id).quantity, 2);
  assert.equal(stockOf(id), 1);
  assert.equal((await leftOf()).held, 0);
  assert.ok(second.orderId);
}, { card: true });

withShop('rule 37quater: a late card payment whose units are gone meanwhile goes paid_conflict, like a taken slot', async ({ call, api, card, clock, stayId }) => {
  const id = await tracked(call, { quantity: 2 });
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 2 }], payment: 'card' })).body.data;
  clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
  api.expireOrders();
  const other = seedStay({ start: -1, end: 2 });
  addLine(other, id, 1);
  api.reconcileStock(other);
  await payLate(orderId, card);
  assert.equal(db.prepare('SELECT status FROM guest_orders WHERE id = ?').get(orderId).status, 'paid_conflict');
  assert.equal(optionLine(stayId, id), undefined);
  assert.equal(stockOf(id), 1);
}, { card: true });

test('rule 37ter: the plugin listens to the four reservation events of the core and brings the stock to date on each', () => {
  const registry = require('../../sdk/registry');
  const { createContext } = require('../../sdk/createContext');
  registry.reset();
  const { register } = require('..');
  register(createContext('guest-app', { db, settingsModel: () => ({ get: () => '', set: () => {}, raw: () => null }) }));
  const { handlers } = registry.get('guest-app');
  ['reservation.created', 'reservation.updated', 'reservation.cancelled', 'reservation.deleted']
    .forEach((name) => assert.equal((handlers.get(name) || []).length, 1, name));
  nextId += 1;
  const id = addOption({ id: nextId, title: 'Vin', price: 9 });
  db.prepare("INSERT OR REPLACE INTO guest_app_items (kind, itemId, sold, stockTracked, stockQuantity) VALUES ('option', ?, 1, 1, 8)").run(id);
  const stay = seedStay({ start: 0, end: 2 });
  addLine(stay, id, 3);
  handlers.get('reservation.updated')[0]({ reservationId: stay });
  assert.equal(stockOf(id), 5);
  db.prepare('UPDATE reservations SET kind = ? WHERE id = ?').run('cancelled', stay);
  handlers.get('reservation.cancelled')[0]({ reservationId: stay });
  assert.equal(stockOf(id), 8);
  registry.reset();
  assert.ok(isoPlus(0));
});
