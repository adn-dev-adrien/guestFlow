// specs/guest-app.md rule 111 b, reading of rule 110 b (owner 2026-11-16, loop t2 AG2-2) — a card order paid before its stay was cancelled reads
// « Payée · à rembourser » in the staff list until the cancellation's refund dialog has given its lines back, then « Remboursée ». A part
// given back leaves it « à rembourser ».
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, db, fakeProvider, openOrdering, seedStay, sell } = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');
const refundsController = require('../../../controllers/refundsController');
const { localIsoDate } = require('../../../utils/localDate');
const { refGivenBack } = require('../../../utils/refundGivenBack');
const { wallClockToDate } = require('../../../utils/stayWindow');

// The clock is pinned to noon of the Paris day (loop t3 P6): a `paidAt` read from the wall clock between 00:00 and 01:00 Paris falls on the previous
// UTC day, the window that broke a sibling suite in round 2.
const pinNoon = (t) => t.mock.timers.enable({ apis: ['Date'], now: wallClockToDate(fx.isoPlus(0), '12:00') });

const CIDER = addOption({ id: 813, title: 'Cidre', price: 6 });
sell('option', CIDER);

const cancel = (stayId) => db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);

function refund(stayId, amountTtc) {
  let sent = null;
  const res = { status(status) { return { json(body) { sent = { status, body }; } }; }, json(body) { sent = { status: 200, body }; } };
  refundsController.create({
    params: { id: String(stayId) }, user: { role: 'admin' },
    body: { refundDate: localIsoDate(), method: 'transfer', lines: [{ key: `opt:${CIDER}`, amountTtc }] },
  }, res);
  return sent;
}

test('rule 110 b reading — « Payée · à rembourser » until the dialog gives the order back, « Remboursée » after; a part given back is not enough', async (t) => {
  pinNoon(t);
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const card = fakeProvider();
  const { call, api, close } = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
  try {
    const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 3 }], payment: 'card' });
    const { orderId } = placed.body.data;
    const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(orderId).paymentLinkId);
    card.pay(link.providerLinkId);
    await processPaidLink({
      ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
    });
    cancel(stayId);
    api.cancelOrdersOf(stayId);
    const label = async () => (await call('GET', '/api/guest-app/orders?status=all')).body.orders.find((o) => o.id === orderId).statusLabel;

    assert.equal(await label(), 'Payée · à rembourser');
    assert.equal(refund(stayId, 6).status, 201);
    assert.equal(await label(), 'Payée · à rembourser', '6 € of 18 € given back: still owed');
    assert.equal(refund(stayId, 12).status, 201);
    assert.equal(await label(), 'Remboursée');
  } finally { await close(); }
});

test('rule 110 b reading — the reading needs lines of that order: another order of the stay is never « given back » by it', () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  assert.equal(refGivenBack(stayId, 'order:999999:'), false);
});
