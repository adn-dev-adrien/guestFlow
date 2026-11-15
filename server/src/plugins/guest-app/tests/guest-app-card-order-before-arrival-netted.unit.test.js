// specs/guest-app.md rules 35, 108 and specs/pricing-components.md rules 21, 31, 93 — a card order paid before the arrival is netted out of the
// stored arrival complement in the sale's own transaction: the bucket states, the SAS's « Rien à encaisser » and a complement link read the row,
// so the guest is never asked a second time at the door for what the card already paid (end review R2-3).
const test = require('node:test');
const assert = require('node:assert/strict');

const fx = require('./guestOrderFixtures');

const { addOption, db, fakeProvider, openOrdering, seedStay, sell } = fx;
const paymentLinksModel = require('../../../models/paymentLinksModel');
const reservationsModel = require('../../../models/reservationsModel');
const { bucketStates } = require('../../../utils/reservationSettlement');
const { nothingToCollect } = require('../../sas/nothingToCollect');
const { isDirectChannel } = require('../../../utils/platformNameFormat');

addOption({ id: 9610, title: 'Cidre carte', price: 6 });
sell('option', 9610);

test('rule 108 — a card order paid two days before the arrival leaves nothing to collect at the door', async () => {
  const stay = seedStay({ start: 2, end: 5, checkedIn: 0, balancePaid: 1 });
  const card = fakeProvider();
  const ctx = await openOrdering(stay, { card });
  try {
    const ordered = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: 9610, quantity: 2 }], payment: 'card' });
    assert.equal(ordered.status, 200, JSON.stringify(ordered.body));
    const order = db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(ordered.body.data.orderId);
    card.pay(paymentLinksModel.findById(order.paymentLinkId).providerLinkId);
    const read = await ctx.call('GET', `/public/v1/guest/orders/${order.id}`);
    assert.equal(read.body.data.status, 'paid');

    const row = db.prepare('SELECT finalPrice, complementAmount, complementPaid FROM reservations WHERE id = ?').get(stay);
    assert.deepEqual(row, { finalPrice: 312, complementAmount: 0, complementPaid: 0 }, 'the 12 € are in the price and out of the arrival complement');
    const full = reservationsModel.getByIdWithDetails(stay);
    assert.equal(bucketStates(full).complement.amount, 0);
    assert.equal(nothingToCollect(full, { bucketStates, isDirectChannel }), true, 'the SAS has nothing to collect');
  } finally { await ctx.close(); }
});
