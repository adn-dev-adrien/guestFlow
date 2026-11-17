// specs/guest-app.md rules 72, 88, 108, 109, 110 (loop t1 B-2, AG-4, AG-5, AG-6) — the money of a guest order on a cancelled stay is owed once: the cancellation
// opens no register row (rule 110 b, the refund dialog is its home) and leaves the gap row of a sale below its payment alone; a payment landing on an order cancelled with its stay is a conflict — never sold, even on a
// stay restored since — shown « Payée · à rembourser ».
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, db, fakeProvider, openOrdering, seedStay, sell } = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const PEAR = addOption({ id: 811, title: 'Poiré', price: 6 });
sell('option', PEAR);

function withStay(name, fn) {
  test(name, async () => {
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
    try { await fn({ stayId, card, ...ctx }); } finally { await ctx.close(); }
  });
}

const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const setKind = (stayId, kind) => db.prepare('UPDATE reservations SET kind = ? WHERE id = ?').run(kind, stayId);
const owedOf = (stayId) => db.prepare("SELECT amountCents, status FROM refund_obligations WHERE reservationId = ? AND origin = 'orderConflict' ORDER BY id").all(stayId);

async function order(call, quantity) {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PEAR, quantity }], payment: 'card' });
  const { orderId } = res.body.data;
  return { orderId, link: db.prepare('SELECT * FROM payment_links WHERE id = ?').get(orderRow(orderId).paymentLinkId) };
}
async function pay(card, link) {
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
}

withStay('B-2, AG-4 — an order sold below its payment leaves a 3 € gap row; the cancellation adds none (rule 110 b: the honoured 15 € are the refund dialog\'s)', async ({ stayId, card, call, api }) => {
  const { link } = await order(call, 3);
  db.prepare('UPDATE property_option_prices SET price = 5 WHERE optionId = ?').run(PEAR);
  db.prepare('UPDATE options SET price = 5 WHERE id = ?').run(PEAR);
  await pay(card, link);
  assert.deepEqual(owedOf(stayId), [{ amountCents: 300, status: 'open' }], 'the gap of a sale below its payment');
  setKind(stayId, 'cancelled');
  api.cancelOrdersOf(stayId);
  assert.deepEqual(owedOf(stayId).map((r) => r.amountCents), [300], 'the gap only');
  api.cancelOrdersOf(stayId);
  assert.equal(owedOf(stayId).length, 1);
  db.prepare('UPDATE options SET price = 6 WHERE id = ?').run(PEAR);
});

withStay('AG-5, AG-6 — a payment landing on an order cancelled with its stay, the stay restored since, sells nothing and is « Payée · à rembourser »', async ({ stayId, card, call, api }) => {
  const { orderId, link } = await order(call, 2);
  setKind(stayId, 'cancelled');
  api.cancelOrdersOf(stayId);
  assert.equal(orderRow(orderId).status, 'cancelled');
  setKind(stayId, 'reservation');
  await pay(card, link);
  assert.equal(orderRow(orderId).status, 'paid_conflict');
  assert.ok(orderRow(orderId).paidAt);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(stayId, PEAR).n, 0, 'nothing sold on the fiche');
  assert.deepEqual(owedOf(stayId), [{ amountCents: 1200, status: 'open' }]);
  const staff = (await call('GET', '/api/guest-app/orders?status=all')).body.orders.find((o) => o.id === orderId);
  assert.equal(staff.statusLabel, 'Payée · à rembourser');
});
