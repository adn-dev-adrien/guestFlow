// specs/guest-app/guest-app.md rules 35-36, 85 and specs/plugins/plugin-removal-resilience.md rules 22, 23 (loop t2 D2-2) — a card link pays the order it was issued for and no other:
// an order wearing the id the link names (an id reused after an erase) is never sold with that money, which is owed back; the order's own link still sells it.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, openOrdering, optionLine, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const { wallClockToDate } = require('../../../utils/stayWindow');

// The clock is pinned to noon of the Paris day (loop t3 P6): a `paidAt` read from the wall clock between 00:00 and 01:00 Paris falls on the previous
// UTC day, the window that broke a sibling suite in round 2.
const pinNoon = (t) => t.mock.timers.enable({ apis: ['Date'], now: wallClockToDate(fx.isoPlus(0), '12:00') });

const PEAR = addOption({ id: 3701, title: 'Poiré lien', price: 6 });
sell('option', PEAR);

const row = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const payLink = async (card, link) => {
  card.pay(link.providerLinkId);
  await processPaidLink({ ...buildPaymentEffectDeps(), link, paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() } });
};

test('D2-2 — a link naming another order\'s id sells nothing and owes its money back; the order\'s own link sells it', async (t) => {
  pinNoon(t);
  const stayId = seedStay();
  const card = fakeProvider();
  const { call, close } = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
  try {
    const order = async (quantity) => (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PEAR, quantity }], payment: 'card' })).body.data.orderId;
    const stale = await order(5);
    const fresh = await order(3);
    const staleLink = paymentLinksModel.findById(row(stale).paymentLinkId);
    // The stale link names the fresh order's id, as an old link does once the erased plugin's counter handed that id out again.
    db.prepare("UPDATE payment_links SET basketJson = json_set(basketJson, '$.ref', ?) WHERE id = ?").run(JSON.parse(staleLink.basketJson).ref === String(stale) ? String(fresh) : fresh, staleLink.id);
    await payLink(card, paymentLinksModel.findById(staleLink.id));
    assert.equal(row(fresh).status, 'awaiting_payment', 'the other order is not sold with this money');
    assert.equal(optionLine(stayId, PEAR), undefined);
    assert.deepEqual(db.prepare('SELECT origin, amountCents, paymentLinkId FROM refund_obligations WHERE reservationId = ?').all(stayId),
      [{ origin: 'orderConflict', amountCents: 3000, paymentLinkId: staleLink.id }]);
    await payLink(card, paymentLinksModel.findById(row(fresh).paymentLinkId));
    assert.equal(row(fresh).status, 'paid');
    assert.equal(optionLine(stayId, PEAR).quantity, 3);
  } finally { await close(); }
});
