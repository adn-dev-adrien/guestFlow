// specs/guest-app.md rules 82, 83, 87, 109 (loop t1 AG-1, AG-3) — the arrival SAS's change of an order's bath: its evening supplement goes with the bath (removed
// with it; a bath that keeps some sessions keeps it whole, so taking one off is refused here), and sessions placed on hours the stay already held are not
// offered for removal (the stay's own line holds them).
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addBath, db, isoPlus, openOrdering, seedStay, sell } = fx;
const BATH = addBath({ id: 9893, freeMinutes: { 1: 60 } });
sell('resource', BATH);
db.prepare("UPDATE resources SET hourlyEveningStart = '19:00', hourlyEveningRate = 40 WHERE id = ?").run(BATH);

const customs = (id) => db.prepare('SELECT description, amount FROM reservation_custom_options WHERE reservationId = ?').all(id);
const complement = (id) => Number(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount);

test('AG-1 — removing an order whose free evening hour owes a supplement removes the supplement too: the complement falls to 0', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '20:00', end: '21:00' }] }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.equal(customs(stayId).length, 1, 'the evening supplement is a line of its own');
    assert.ok(complement(stayId) > 0);
    const removed = await ctx.call('POST', `/api/guest-app/orders/${placed.body.data.orderId}/amend`, { removeOrder: true });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(customs(stayId), []);
    assert.equal(complement(stayId), 0);
  } finally { await ctx.close(); }
});

test('AG-1 — taking one session off a supplemented bath is refused here (409 ORDER_NOT_EDITABLE): the supplement is never left half-billed', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const sessions = [{ date: isoPlus(6), start: '20:00', end: '21:00' }, { date: isoPlus(7), start: '20:00', end: '21:00' }];
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.equal(customs(stayId).length, 1);
    const before = complement(stayId);
    const out = await ctx.call('POST', `/api/guest-app/orders/${placed.body.data.orderId}/amend`, { removeSessions: [{ resourceId: BATH, date: isoPlus(7), start: '20:00' }] });
    assert.deepEqual([out.status, out.body.code], [409, 'ORDER_NOT_EDITABLE']);
    assert.equal(complement(stayId), before);
  } finally { await ctx.close(); }
});

test('AG-3 — a bath whose sessions sit on hours the stay already held is not removable from the SAS, and its amend is refused', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, propertyId: 2 });
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, totalPrice, offered, inComplement, sessions) VALUES (?, ?, 1, 30, 1, 0, 1, 0, '[]')").run(stayId, BATH);
  const ctx = await openOrdering(stayId, { propertyId: 2 });
  try {
    const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '10:00', end: '11:00' }, { date: isoPlus(6), start: '12:00', end: '13:00' }] }];
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    const view = ctx.api.ordersAtArrival(stayId);
    const row = view.orders[0].lines.find((l) => l.key === `res:${BATH}`);
    assert.equal(row.removable, false);
    const out = await ctx.call('POST', `/api/guest-app/orders/${placed.body.data.orderId}/amend`, { removeOrder: true });
    assert.deepEqual([out.status, out.body.code], [409, 'ORDER_NOT_EDITABLE']);
  } finally { await ctx.close(); }
});
