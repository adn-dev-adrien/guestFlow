// specs/guest-app.md rule 110 a, reading of 2026-11-16 (owner, loop t2) — an app order stays editable at the arrival SAS until the arrival is
// validated, but never after the stay's departure day: an arrival never validated does not keep the order open once the stay is over.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, db, isoPlus, openOrdering, seedStay, sell } = fx;
const { wallClockToDate } = require('../../../utils/stayWindow');

const MEAD = addOption({ id: 964, title: 'Hydromel doux', price: 6 });
sell('option', MEAD, { maxQuantity: 5 });

const quantities = (id) => db.prepare('SELECT quantity FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, MEAD).map((l) => l.quantity);
const complement = (id) => Number(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount);

async function withUnvalidatedArrival(at, fn) {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: MEAD, quantity: 2 }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    ctx.clock.now = at();
    await fn({ stayId, orderId: placed.body.data.orderId, ...ctx });
  } finally {
    await ctx.close();
  }
}
const amend = (call, id, body) => call('POST', `/api/guest-app/orders/${id}/amend`, body);

test('rule 110 a — the departure day itself, arrival never validated: the order is still editable', async () => {
  await withUnvalidatedArrival(() => wallClockToDate(isoPlus(9), '09:00'), async ({ stayId, orderId, call, api }) => {
    assert.equal(api.ordersAtArrival(stayId).orders[0].editable, true);
    const done = await amend(call, orderId, { lines: [{ key: `opt:${MEAD}`, quantity: 1 }] });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(quantities(stayId), [1]);
  });
});

test('rule 110 a — the day after the departure, arrival never validated: 409 ORDER_NOT_EDITABLE, nothing written', async () => {
  await withUnvalidatedArrival(() => wallClockToDate(isoPlus(10), '00:30'), async ({ stayId, orderId, call, api }) => {
    assert.equal(api.ordersAtArrival(stayId).orders[0].editable, false);
    const refused = await amend(call, orderId, { lines: [{ key: `opt:${MEAD}`, quantity: 1 }] });
    assert.deepEqual([refused.status, refused.body.code], [409, 'ORDER_NOT_EDITABLE']);
    const removed = await amend(call, orderId, { removeOrder: true });
    assert.deepEqual([removed.status, removed.body.code], [409, 'ORDER_NOT_EDITABLE']);
    assert.deepEqual(quantities(stayId), [2]);
    assert.equal(complement(stayId), 12);
  });
});
