// specs/guest-app.md rule 85 and specs/pricing-components.md rules 23, 75 (review defect D7, M6 / M7) — the line of a card-paid order is the provider's money: the operator
// can offer it only through the fiche's confirmation, and the excess it leaves is a refund obligation (`lineLowered`), never a silent credit.
const fx = require('../plugins/guest-app/tests/guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, openOrdering, seedStay, sell,
} = fx;
const { processPaidLink } = require('../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../utils/paymentEffectDeps');
const paymentLinksModel = require('../models/paymentLinksModel');
const extraSale = require('../utils/extraSale');

const CIDER = addOption({ id: 3881, title: 'Cidre payé', price: 6 });
sell('option', CIDER);

test('rule 23 — offering a card-paid shop line is refused until confirmed (409 OVERPAID), then it opens a lineLowered obligation for what was paid', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const card = fakeProvider();
  const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
  try {
    const { orderId } = (await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'card' })).body.data;
    const link = paymentLinksModel.findById(db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(orderId).paymentLinkId);
    card.pay(link.providerLinkId);
    await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() } });
    const lineId = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(stayId, CIDER).lineId;
    const refused = extraSale.changeLine(stayId, `option:${lineId}`, { offered: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'OVERPAID');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refund_obligations WHERE reservationId = ?').get(stayId).n, 0, 'nothing owed before the confirmation');
    assert.equal(extraSale.changeLine(stayId, `option:${lineId}`, { offered: true }, { forceOverpayment: true }).status, 200);
    assert.deepEqual(db.prepare("SELECT origin, amountCents FROM refund_obligations WHERE reservationId = ? AND status = 'open'").all(stayId), [{ origin: 'lineLowered', amountCents: 1200 }]);
  } finally { await ctx.close(); }
});
