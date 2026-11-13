// specs/guest-app.md rules 25, 33, 35, 36, 37quater and §4.3 — the money of a card order kept whole: a card order
// awaiting its payment reserves nothing (reading of 2026-11-13), the fiche is never billed beyond what was paid (a price
// raised meanwhile is a conflict, a price lowered flags the gap « à rembourser »), a payment finds the units left at that moment, an abandoned order is never committed, the return page does not call the provider on every
// poll, a replayed `Idempotency-Key` answers the first order, and the link bills exactly the quoted total.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, endOfStayDetail, fakeProvider, hasHourly, historyOf, isoPlus, notesOf, openOrdering, optionLine, seedStay, sell,
} = fx;
const { buildLedger } = require('../../../utils/reservationLedger');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const BATH = addBath({ id: 76, freeMinutes: { 1: 60 } });
sell('resource', BATH);
let nextId = 760;
/** A fresh option sold in the app, so each test re-prices its own. */
function cider(price = 6) {
  nextId += 1;
  const id = addOption({ id: nextId, title: `Cidre ${nextId}`, price });
  sell('option', id);
  return id;
}

const TOMORROW = isoPlus(1);
const slot = (start, end) => ({ date: TOMORROW, start, end });

function withCard(name, fn, { skip = false, ...options } = {}) {
  test(name, { skip }, async () => {
    const stayId = seedStay();
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test', ...options });
    try {
      await fn({ stayId, card, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const linkOf = (orderId) => paymentLinksModel.findById(orderRow(orderId).paymentLinkId);
const ledgerOf = (stayId) => buildLedger({ row: db.prepare('SELECT * FROM reservations WHERE id = ?').get(stayId), links: paymentLinksModel.listForReservation(stayId) });
// Rule 85: an article sold twice is two lines — the first keeps `res:<id>`, a later one is `line:reservation_resources:<lineId>`; the bath is the only resource here.
const bathOwed = (stayId) => endOfStayDetail(stayId).filter((l) => l.key === `res:${BATH}` || String(l.key).startsWith('line:reservation_resources:')).reduce((sum, l) => sum + l.amount, 0);
/** The guest pays the order's link; the return page reads it at the provider. */
async function pay(call, card, orderId) {
  card.pay(linkOf(orderId).providerLinkId);
  return (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
}

withCard('rules 25, 35: a card order awaiting payment reserves no free hour — the next order takes it, and the card order paid after it would cost more than was paid: conflict, money owed back', async ({ stayId, call, card }) => {
  const a = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [slot('10:00', '11:00'), slot('14:00', '15:00')] }], payment: 'card' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const orderA = a.body.data.orderId;
  assert.equal(orderRow(orderA).total, 30, '2 h, the first offered');
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  const bath = shop.categories.flatMap((c) => c.items).find((i) => i.kind === 'resource' && i.id === BATH);
  assert.doesNotMatch(String(bath.freeLeftLabel), /déjà utilisée/, 'the shop does not read the free hour as taken');
  const lineB = [{ kind: 'resource', id: BATH, sessions: [slot('17:00', '18:00')] }];
  assert.equal((await call('POST', '/public/v1/guest/orders/quote', { lines: lineB })).body.data.total, 0, 'the free hour is still free');
  const b = await call('POST', '/public/v1/guest/orders', { lines: lineB, payment: 'note' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(orderRow(b.body.data.orderId).total, 0, 'the free hour went to the order placed second');
  const page = await pay(call, card, orderA);
  assert.equal(page.status, 'paid_conflict', 'sold now it costs 60 €, more than the 30 € paid');
  assert.equal(notesOf(stayId).some((n) => n.ref === String(orderA)), false, 'nothing reached the fiche');
  assert.equal(JSON.parse(linkOf(orderA).basketJson).refundOwed, true);
  assert.equal(ledgerOf(stayId).rows.find((r) => r.key === 'basketRefunds').amount, 30);
}, { skip: !hasHourly });

withCard('rule 35: a price lowered between the link and the payment — the order is committed at its new price, the gap flagged « à rembourser » with a history entry and a ledger row', async ({ stayId, call, card }) => {
  const id = cider(6);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 3 }], payment: 'card' })).body.data;
  assert.equal(linkOf(orderId).amountCents, 1800);
  db.prepare('UPDATE options SET price = 4 WHERE id = ?').run(id);
  const page = await pay(call, card, orderId);
  assert.equal(page.status, 'paid');
  assert.equal(optionLine(stayId, id).quantity, 3);
  assert.equal(notesOf(stayId).find((n) => n.ref === String(orderId)).total, 12);
  const basket = JSON.parse(linkOf(orderId).basketJson);
  assert.deepEqual([basket.refundOwed, basket.refundCents], [true, 600]);
  assert.ok(historyOf(stayId).some((c) => c.field === 'refundOwed' && /^6,00.€ sur 18,00.€ payés/.test(c.to)), JSON.stringify(historyOf(stayId)));
  const row = ledgerOf(stayId).rows.find((r) => r.key === 'basketRefunds');
  assert.deepEqual([row.label, row.amount], ['Commande client à rembourser', 6]);
});

withCard('rule 35: a price raised between the link and the payment — never billed silently: `paid_conflict`, nothing on the fiche, the whole payment « à rembourser »', async ({ stayId, call, card, pushes }) => {
  const id = cider(6);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 3 }], payment: 'card' })).body.data;
  db.prepare('UPDATE options SET price = 8 WHERE id = ?').run(id);
  const page = await pay(call, card, orderId);
  assert.equal(page.status, 'paid_conflict');
  assert.equal(optionLine(stayId, id), undefined);
  assert.equal(notesOf(stayId).some((n) => n.ref === String(orderId)), false);
  assert.equal(JSON.parse(linkOf(orderId).basketJson).refundOwed, true);
  assert.equal(ledgerOf(stayId).rows.find((r) => r.key === 'basketRefunds').amount, 18);
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.ok(pushes.some((p) => /à rembourser/.test(p.payload.body)), 'the staff is told');
});

withCard('rule 37quater: an unpaid order holds no units — paid while enough are left it is sold, paid after they went it is a conflict', async ({ stayId, call, card }) => {
  const id = cider(6);
  assert.equal((await call('PUT', `/api/guest-app/items/option/${id}`, { stockTracked: true, stockQuantity: 2 })).status, 200);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 2 }], payment: 'card' })).body.data;
  assert.equal(JSON.parse(JSON.stringify((await call('GET', '/public/v1/guest/shop')).body.data)).categories.flatMap((c) => c.items).find((i) => i.id === id).stock.left, 2, 'nothing held');
  assert.equal((await pay(call, card, orderId)).status, 'paid');
  assert.equal(optionLine(stayId, id).quantity, 2);
  const scarce = cider(6);
  assert.equal((await call('PUT', `/api/guest-app/items/option/${scarce}`, { stockTracked: true, stockQuantity: 1 })).status, 200);
  const first = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: scarce, quantity: 1 }], payment: 'card' })).body.data;
  const second = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: scarce, quantity: 1 }], payment: 'card' })).body.data;
  assert.equal((await pay(call, card, first.orderId)).status, 'paid');
  assert.equal((await pay(call, card, second.orderId)).status, 'paid_conflict', 'the last unit went to the first payment');
});

withCard('rule 35: a payment that lands on an abandoned order is never committed — `paid_conflict`, the money « à rembourser »', async ({ stayId, call, api }) => {
  const id = cider(6);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 1 }], payment: 'card' })).body.data;
  assert.equal((await call('POST', `/public/v1/guest/orders/${orderId}/abandon`)).status, 200);
  const outcome = api.orderPaid({ reservationId: stayId, ref: orderId, amountCents: 600, paidDate: isoPlus(0), paidAt: new Date().toISOString(), providerPaymentId: 'pay_x' });
  assert.equal(outcome.refundOwed, true);
  assert.equal(orderRow(orderId).status, 'paid_conflict');
  assert.equal(optionLine(stayId, id), undefined, 'its lines went back to the cart, not to the fiche');
});

withCard('§4.3: the return page polls its order — the provider is read for its link once per 10 seconds at most', async ({ call, card, clock }) => {
  let reads = 0;
  const read = card.provider.getPayment;
  card.provider.getPayment = async (...args) => { reads += 1; return read(...args); };
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: cider(6), quantity: 1 }], payment: 'card' })).body.data;
  await call('GET', `/public/v1/guest/orders/${orderId}`);
  await call('GET', `/public/v1/guest/orders/${orderId}`);
  await call('GET', `/public/v1/guest/orders/${orderId}`);
  assert.equal(reads, 1);
  clock.now = new Date(clock.now.getTime() + 11 * 1000);
  await call('GET', `/public/v1/guest/orders/${orderId}`);
  assert.equal(reads, 2);
});

/** `POST /orders` with an `Idempotency-Key`, on the session's cookie. */
async function postKeyed({ base, cookies }, key, body) {
  const res = await fetch(`${base}/public/v1/guest/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.value, 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

withCard('§4.3: a double tap sends the same `Idempotency-Key` — one order, the second answer is the first', async (ctx) => {
  const { stayId, card } = ctx;
  const id = cider(6);
  const note = { lines: [{ kind: 'option', id, quantity: 1 }], payment: 'note' };
  const first = await postKeyed(ctx, 'tap-note-0001', note);
  const second = await postKeyed(ctx, 'tap-note-0001', note);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(second.body, first.body);
  assert.equal(optionLine(stayId, id).quantity, 1, 'written once on the fiche');
  const paid = { lines: [{ kind: 'option', id, quantity: 2 }], payment: 'card' };
  const once = await postKeyed(ctx, 'tap-card-0001', paid);
  const twice = await postKeyed(ctx, 'tap-card-0001', paid);
  assert.deepEqual(twice.body, once.body);
  assert.equal(card.created.length, 1, 'one link');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stayId).n, 2);
  assert.equal((await postKeyed(ctx, 'bad key!', paid)).status, 400);
});

withCard('rule 35: a card order awaiting its payment blocks nothing — a second card order and a note are accepted; a key replayed after the abandon is spent', async (ctx) => {
  const { call, card } = ctx;
  const id = cider(6);
  const paid = { lines: [{ kind: 'option', id, quantity: 1 }], payment: 'card' };
  const first = await postKeyed(ctx, 'wait-card-0001', paid);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await postKeyed(ctx, 'wait-card-0002', paid);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(card.created.length, 2, 'each its own link');
  const note = await postKeyed(ctx, 'wait-note-0001', { ...paid, payment: 'note' });
  assert.equal(note.status, 200, JSON.stringify(note.body));
  assert.equal((await call('POST', `/public/v1/guest/orders/${first.body.data.orderId}/abandon`)).status, 200);
  const spent = await postKeyed(ctx, 'wait-card-0001', paid);
  assert.equal(spent.status, 409);
  assert.equal(spent.body.error.code, 'ORDER_KEY_SPENT', 'an abandoned order’s link is never handed back');
  const again = await postKeyed(ctx, 'wait-card-0003', paid);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.notEqual(again.body.data.orderId, first.body.data.orderId);
});

withCard('rule 33: the link bills exactly the quoted total — the order’s own lines, nothing the sale raised beside them (pricing-components rules 8, 9)', async ({ call, card }) => {
  const id = cider(6);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity: 1 }], payment: 'card' })).body.data;
  assert.equal(orderRow(orderId).total, 6);
  assert.equal(linkOf(orderId).amountCents, 600);
  assert.equal(card.created[0].amountCents, 600);
});

withCard('rule 25: a 0 € order never needs a link, whatever payment the cart asked', async ({ call, card }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [slot('19:00', '20:00')] }], payment: 'card' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'confirmed');
  assert.equal(card.created.length, 0);
}, { skip: !hasHourly });

withCard('rule 36: a card payment that lands after the stay was cancelled reaches its order — `paid_conflict`, the money « à rembourser »', async ({ stayId, call, card }) => {
  const { processPaidLink } = require('../../../utils/paymentPollRunner');
  const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: cider(6), quantity: 1 }], payment: 'card' })).body.data;
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
  const link = linkOf(orderId);
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link, paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
  assert.equal(orderRow(orderId).status, 'paid_conflict');
  assert.equal(JSON.parse(linkOf(orderId).basketJson).refundOwed, true);
  assert.ok(historyOf(stayId).some((c) => c.field === 'refundOwed'));
});

withCard('rule 35: an unpaid card order carries its link while it lives — « Reprendre le paiement » — and not once expired or paid', async ({ call, card, clock, api }) => {
  const { orderId, paymentUrl } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: cider(6), quantity: 1 }], payment: 'card' })).body.data;
  assert.equal((await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data.paymentUrl, paymentUrl);
  assert.equal((await call('GET', '/public/v1/guest/orders')).body.data.orders.find((o) => o.id === orderId).paymentUrl, paymentUrl);
  clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
  assert.equal((await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data.paymentUrl, undefined, 'its link lapsed');
  api.expireOrders();
  assert.equal((await call('GET', '/public/v1/guest/orders')).body.data.orders.find((o) => o.id === orderId).paymentUrl, undefined);
  const other = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: cider(6), quantity: 1 }], payment: 'card' })).body.data;
  const paid = await pay(call, card, other.orderId);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paymentUrl, undefined);
});
