// specs/guest-app.md rules 85, 106 and specs/pricing-components.md rules 21, 31 (review defect D6, M5) — a card-paid order is netted wherever the arrival complement is read: the
// engine's quote, the sale detail's arrival bucket, the SAS step's « à percevoir »; a note order beside it keeps the complement for itself alone.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, openOrdering, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const { quoteStoredReservation } = require('../../../utils/storedReservationQuote');
const extraSale = require('../../../utils/extraSale');

const CIDER = addOption({ id: 3871, title: 'Cidre net', price: 6 });
sell('option', CIDER);

test('rules 21, 106 — the card order is paid and read net everywhere; the unpaid one is the only thing to collect at the arrival', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const card = fakeProvider();
  const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
  try {
    const { orderId } = (await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 3 }], payment: 'card' })).body.data;
    const link = paymentLinksModel.findById(db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(orderId).paymentLinkId);
    card.pay(link.providerLinkId);
    await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() } });
    const note = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(stayId);
    assert.equal(quoteStoredReservation(db, row).complementAmount, 6, 'the engine: only the note order');
    assert.equal(extraSale.saleDetailOf(stayId).buckets.arrival, 600, 'the sale detail: the same');
    const step = ctx.api.ordersAtArrival(stayId);
    assert.deepEqual([step.toCollect, step.paid], [6, 18], 'the SAS step: 6 € to collect, 18 € paid by card');
  } finally { await ctx.close(); }
});
