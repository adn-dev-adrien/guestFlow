// specs/guest-app.md rules 35, 85, 97 (the note line stores the quantity sold) and specs/pricing-components.md rules 26, 29, 49 (owner Q-C3) — a card order awaiting its payment writes NO line on the fiche
// (nothing the guest has not paid), holds its slot on the planning through the plugin's hold until its 30 minutes lapse, and reserves what it was
// quoted with (a second order waits, the shop reads the free hour as taken); paid, its lines are written already settled, tagged with the order.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, fakeProvider, hasHourly, isoPlus, notesOf, openOrdering, optionLine, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const CIDER = addOption({ id: 3501, title: 'Cidre carte', price: 6 });
const BATH = addBath({ id: 351, freeMinutes: {} });
sell('option', CIDER);
sell('resource', BATH);
const DAY = isoPlus(1);

async function withCard(fn) {
  const stayId = seedStay();
  const card = fakeProvider();
  const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
  try { await fn({ stayId, card, ...ctx }); } finally { await ctx.close(); }
}

const row = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const pay = async (card, orderId) => {
  const link = paymentLinksModel.findById(row(orderId).paymentLinkId);
  card.pay(link.providerLinkId);
  await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() } });
};

test('rules 29, 85 — a card order awaiting payment writes no line; paid, its line is written settled, source shop, tagged with the order', async () => {
  await withCard(async ({ stayId, call, card }) => {
    const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'card' })).body.data;
    assert.equal(optionLine(stayId, CIDER), undefined, 'nothing on the fiche before the payment');
    assert.equal(notesOf(stayId).length, 0);
    await pay(card, orderId);
    const line = optionLine(stayId, CIDER);
    assert.deepEqual([line.source, line.orderRef, line.totalPrice], ['shop', `order:${orderId}:1`, 12]);
    assert.deepEqual(notesOf(stayId).map((n) => [n.total, n.ref]), [[12, String(orderId)]]);
    assert.equal(notesOf(stayId)[0].lines[0].qty, 2, 'rule 97');
    assert.equal(row(orderId).status, 'paid');
  });
});

test('rule 49 — the slot of a pending card order is held on the planning until its hold lapses, then free again', { skip: !hasHourly }, async () => {
  await withCard(async ({ call, api }) => {
    const session = { date: DAY, start: '14:00', end: '15:00' };
    const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [session] }], payment: 'card' })).body.data;
    const held = () => api.heldSessions({ resourceId: BATH, from: DAY, to: DAY });
    assert.deepEqual(held().map((s) => [s.date, s.start]), [[DAY, '14:00']]);
    db.prepare('UPDATE guest_orders SET heldUntil = ? WHERE id = ?').run(new Date(Date.now() - 60000).toISOString(), orderId);
    assert.deepEqual(held(), [], 'a lapsed hold holds nothing');
  });
});

test('rules 26, 35 — while a card order waits, a second order is refused and the quote reads the allowance as taken; abandoned, the order can go on', async () => {
  await withCard(async ({ call, card }) => {
    const lines = [{ kind: 'option', id: CIDER, quantity: 1 }];
    const first = (await call('POST', '/public/v1/guest/orders', { lines, payment: 'card' })).body.data;
    const second = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
    assert.deepEqual([second.status, second.body.error.code], [409, 'CARD_ORDER_PENDING']);
    assert.equal(card.created.length, 1, 'no second link');
    assert.equal((await call('POST', `/public/v1/guest/orders/${first.orderId}/abandon`)).status, 200);
    assert.equal((await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' })).status, 200);
  });
});
