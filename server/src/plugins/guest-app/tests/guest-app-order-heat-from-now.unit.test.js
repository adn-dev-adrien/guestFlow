// specs/guest-app.md rule 79 (audit of the J-7 branch, item 7 / M22) — the order judges the bath's heat-up from NOW, exactly as the picker
// offered it: a slot the picker listed (the arrival day's first hour, a week ahead, a 4 h heat-up) is accepted by the quote, the order and
// the card payment's re-check, never refused as « heating » because the check-in was taken as the start of the heating.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, fakeProvider, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { skipWithout } = require('../../sdk/testing');
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const BATH = addBath({ id: 72, freeMinutes: {} });
sell('resource', BATH);
db.prepare(`UPDATE resources SET hourlyEveningStart = '19:00', hourlyEveningRate = 40, heatUpMinutes = 240, heatRetentionMinutes = 120,
  turnoverMinutes = 0, showsPlanningCard = 1 WHERE id = ?`).run(BATH);

const ARRIVAL_HOUR = { date: isoPlus(5), start: '16:00', end: '17:00' };

function withBath(name, fn) {
  test(name, { skip: skipWithout(['hourly-resources']) }, async () => {
    db.prepare('DELETE FROM resource_bookings').run();
    db.prepare('DELETE FROM reservation_resources').run();
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

const lines = [{ kind: 'resource', id: BATH, sessions: [ARRIVAL_HOUR] }];

withBath('rule 79: the picker offers the arrival hour a week ahead — and the quote and the order accept it', async ({ call }) => {
  const slots = (await call('GET', `/public/v1/guest/shop/resources/${BATH}/slots`)).body.data;
  assert.ok(slots.days.find((d) => d.date === ARRIVAL_HOUR.date).slots.some((s) => s.start === '16:00'), 'offered by the picker');
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines });
  assert.equal(quote.body.data.lines[0].unavailable, undefined, 'the quote does not call it heating');
  const placed = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
});

withBath('rule 79: a card order for it is still honoured when the payment lands — the re-check counts the heat-up from now too', async ({ call, card }) => {
  const placed = await call('POST', '/public/v1/guest/orders', { lines, payment: 'card' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const { orderId } = placed.body.data;
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(orderId).paymentLinkId);
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
  assert.equal(db.prepare('SELECT status FROM guest_orders WHERE id = ?').get(orderId).status, 'paid', 'not paid_conflict: the slot still stood');
});
