// specs/guest-app.md rule 110 b (owner, 2026-11-16, loop t1 B-2) — the money of a card order on a cancelled stay has ONE home. Paid before the
// cancellation, the order is a collected line of the stay: its refund lives in the cancellation's refund dialog only, the « À rembourser » register
// holds no row for it, and the dialog never gives it back twice. Paid after the cancellation, nothing reached the fiche: the register's
// `orderConflict` row is its only home and the dialog does not offer it.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, db, fakeProvider, openOrdering, seedStay, sell } = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const refundsController = require('../../../controllers/refundsController');

const MEAD = addOption({ id: 812, title: 'Hydromel', price: 6 });
sell('option', MEAD);

function withStay(name, fn) {
  test(name, async () => {
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
    try { await fn({ stayId, card, ...ctx }); } finally { await ctx.close(); }
  });
}

const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const cancel = (stayId) => db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
const register = (stayId) => db.prepare('SELECT origin, amountCents, status FROM refund_obligations WHERE reservationId = ? ORDER BY id').all(stayId);

async function order(call, quantity) {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: MEAD, quantity }], payment: 'card' });
  const { orderId } = res.body.data;
  return { orderId, link: db.prepare('SELECT * FROM payment_links WHERE id = ?').get(orderRow(orderId).paymentLinkId) };
}
async function pay(card, link) {
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
}

function call(handler, stayId, body) {
  let sent = null;
  const res = {
    status(status) { return { json(payload) { sent = { status, body: payload }; } }; },
    json(payload) { sent = { status: 200, body: payload }; },
  };
  refundsController[handler]({ params: { id: String(stayId) }, body, user: { role: 'admin' } }, res);
  return sent;
}
const dialogLine = (stayId) => call('list', stayId).body.refundableLines.find((line) => /Hydromel/.test(line.label));
const today = () => new Date().toISOString().slice(0, 10);
const refund = (stayId, line, amountTtc) => call('create', stayId, {
  refundDate: today(), method: 'transfer', lines: [{ key: line.key, amountTtc }],
});

withStay('rule 110 b — paid before the cancellation: no register row, the dialog offers the 18 € once, a second refund of it is refused', async ({ stayId, card, call: guest, api }) => {
  const { orderId, link } = await order(guest, 3);
  await pay(card, link);
  assert.equal(orderRow(orderId).status, 'paid');
  cancel(stayId);
  api.cancelOrdersOf(stayId);
  assert.equal(orderRow(orderId).status, 'cancelled');
  assert.deepEqual(register(stayId), [], 'the « À rembourser » register does not repeat the order');
  const line = dialogLine(stayId);
  assert.ok(line, 'the order is a collected line of the cancelled stay');
  assert.equal(Math.round(line.refundableTtc * 100), 1800);
  const first = refund(stayId, line, 18);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(dialogLine(stayId), undefined, 'the line given back leaves the dialog');
  const second = refund(stayId, line, 18);
  assert.deepEqual([second.status, second.body.code], [400, 'REFUND_UNKNOWN_LINE'], 'the same money is never refunded twice');
  api.cancelOrdersOf(stayId);
  assert.deepEqual(register(stayId), [], 'a second cancellation pass opens nothing either');
});

withStay('rule 110 b — paid after the cancellation: the register row is the only home, the dialog does not offer the order', async ({ stayId, card, call: guest, api }) => {
  const { orderId, link } = await order(guest, 2);
  cancel(stayId);
  api.cancelOrdersOf(stayId);
  await pay(card, link);
  assert.equal(orderRow(orderId).status, 'paid_conflict');
  assert.deepEqual(register(stayId), [{ origin: 'orderConflict', amountCents: 1200, status: 'open' }]);
  assert.equal(dialogLine(stayId), undefined, 'nothing reached the fiche: the dialog has no line for it');
  api.cancelOrdersOf(stayId);
  assert.equal(register(stayId).length, 1, 'owed once');
});

withStay('rule 110 b, rule 109 a — an order sold below its payment: the gap stays the register\'s, the honoured 15 € the dialog\'s', async ({ stayId, card, call: guest, api }) => {
  const { link } = await order(guest, 3);
  db.prepare('UPDATE options SET price = 5 WHERE id = ?').run(MEAD);
  await pay(card, link);
  db.prepare('UPDATE options SET price = 6 WHERE id = ?').run(MEAD);
  assert.deepEqual(register(stayId).map((r) => r.amountCents), [300], 'the gap of a sale below its payment');
  cancel(stayId);
  api.cancelOrdersOf(stayId);
  assert.deepEqual(register(stayId).map((r) => r.amountCents), [300], 'the cancellation adds no row');
  assert.equal(Math.round(dialogLine(stayId).refundableTtc * 100), 1500);
});
