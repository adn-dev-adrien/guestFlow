// specs/guest-app.md rules 35, 36, 88 and specs/pricing-components.md rule 75 — a paid order that can no longer be honoured (a price that rose, a slot gone,
// an abandoned order, a stay cancelled) opens ONE refund obligation of origin `orderConflict`, for what was paid; `flagBasketRefund` and `deferredCents` are gone.
const fx = require('../plugins/guest-app/tests/guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, openOrdering, optionLine, seedStay, sell,
} = fx;
const { processPaidLink } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const paymentLinksModel = require('../models/paymentLinksModel');

const CIDER = addOption({ id: 3601, title: 'Cidre conflit', price: 6 });
sell('option', CIDER);

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
  return link;
};
const owed = (stayId) => db.prepare('SELECT origin, amountCents, status, paymentLinkId FROM refund_obligations WHERE reservationId = ?').all(stayId);

test('rule 75 — a price raised between the link and the payment: paid_conflict, no line, one open `orderConflict` obligation for the whole payment', async () => {
  await withCard(async ({ stayId, call, card }) => {
    const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 3 }], payment: 'card' })).body.data;
    db.prepare('UPDATE options SET price = 8 WHERE id = ?').run(CIDER);
    const link = await pay(card, orderId);
    assert.equal(row(orderId).status, 'paid_conflict');
    assert.equal(optionLine(stayId, CIDER), undefined, 'nothing on the fiche');
    assert.deepEqual(owed(stayId), [{ origin: 'orderConflict', amountCents: 1800, status: 'open', paymentLinkId: link.id }]);
  });
});

test('rule 75 — an order abandoned before its payment landed is not honoured either: the same obligation, once', async () => {
  db.prepare('UPDATE options SET price = 6 WHERE id = ?').run(CIDER);
  await withCard(async ({ stayId, call, card }) => {
    const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' })).body.data;
    db.prepare("UPDATE guest_orders SET status = 'abandoned', heldUntil = NULL WHERE id = ?").run(orderId);
    await pay(card, orderId);
    assert.deepEqual(owed(stayId).map((o) => [o.origin, o.amountCents]), [['orderConflict', 600]]);
  });
});
