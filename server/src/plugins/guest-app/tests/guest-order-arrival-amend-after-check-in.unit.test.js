// specs/guest-app.md rules 87, 110 a (owner, 2026-11-16, loop t1 AG-2) — an order taken before the arrival stays editable at the arrival SAS until the arrival is
// VALIDATED, whatever the hour: a guest who arrives after the check-in time has the order changed at the door, the kept lines stay in the arrival complement
// (never moved to the departure), and the edit closes once the arrival is marked.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, endOfStayDetail, isoPlus, openOrdering, seedStay, sell,
} = fx;

const PERRY = addOption({ id: 963, title: 'Poiré fermier', price: 6 });
sell('option', PERRY, { maxQuantity: 5 });

const complement = (id) => Number(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount);
const lines = (id) => db.prepare('SELECT quantity, collectAt, inComplement FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, PERRY);
// The arrival day, 18:00 in Paris: two hours past the stay's 16:00 check-in.
const afterCheckIn = () => new Date(`${isoPlus(5)}T18:00:00+01:00`);

async function withLateArrival(fn) {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PERRY, quantity: 2 }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.equal(complement(stayId), 12);
    ctx.clock.now = afterCheckIn();
    await fn({ stayId, orderId: placed.body.data.orderId, ...ctx });
  } finally {
    await ctx.close();
  }
}
const amend = (call, id, body) => call('POST', `/api/guest-app/orders/${id}/amend`, body);

test('rule 110 a — past the check-in hour, arrival not validated: the step is editable and the change lands in the arrival complement', async () => {
  await withLateArrival(async ({ stayId, orderId, call, api }) => {
    const step = api.ordersAtArrival(stayId);
    assert.equal(step.orders[0].editable, true, 'the check-in hour does not close the edit');
    const done = await amend(call, orderId, { lines: [{ key: `opt:${PERRY}`, quantity: 1 }] });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.order.editable, true);
    assert.deepEqual(lines(stayId).map((l) => [l.quantity, l.collectAt, l.inComplement]), [[1, 'arrival', 1]], 'the kept line is the arrival\'s');
    assert.equal(complement(stayId), 6, 'the arrival complement asks for what is kept');
    assert.deepEqual(endOfStayDetail(stayId), [], 'nothing moved to the departure');
  });
});

test('rule 110 a — the whole order removed after the check-in hour: the arrival complement falls to 0', async () => {
  await withLateArrival(async ({ stayId, orderId, call }) => {
    const done = await amend(call, orderId, { removeOrder: true });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(lines(stayId), []);
    assert.equal(complement(stayId), 0);
  });
});

test('rule 110 a — once the arrival is validated the edit closes: 409 ORDER_NOT_EDITABLE, nothing written', async () => {
  await withLateArrival(async ({ stayId, orderId, call, api }) => {
    db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(stayId);
    assert.equal(api.ordersAtArrival(stayId).orders[0].editable, false);
    const refused = await amend(call, orderId, { lines: [{ key: `opt:${PERRY}`, quantity: 1 }] });
    assert.deepEqual([refused.status, refused.body.code], [409, 'ORDER_NOT_EDITABLE']);
    assert.deepEqual(lines(stayId).map((l) => l.quantity), [2]);
    assert.equal(complement(stayId), 12);
  });
});
