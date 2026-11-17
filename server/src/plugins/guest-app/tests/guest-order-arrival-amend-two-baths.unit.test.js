// specs/guest-app.md rules 83, 87, 112 (loop t3 A3-1) — an order with two baths, one of them supplemented: at the arrival SAS the evening supplement goes
// with ITS bath only. Removing the other bath, or taking one session off it, leaves the supplement and its money in place. Every case orders a bath:
// without hourly-resources the suite has nothing to prove (plugin-removal-resilience rules 4, 7).
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addBath, db, isoPlus, openOrdering, seedStay, sell } = fx;
const BATH = addBath({ id: 9961, freeMinutes: { 1: 60 } });
sell('resource', BATH);
db.prepare("UPDATE resources SET hourlyEveningStart = '19:00', hourlyEveningRate = 40 WHERE id = ?").run(BATH);
const SAUNA = 9962;
db.prepare(`INSERT INTO resources (id, name, priceType, price, quantity, openTime, closeTime, slotDuration, minimumUsageMinutes)
            VALUES (?, 'Sauna', 'per_hour', 25, 1, '08:00', '22:00', 60, 60)`).run(SAUNA);
[1, 2].forEach((p) => db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(SAUNA, p));
sell('resource', SAUNA);

const customs = (id) => db.prepare('SELECT amount, fulfilmentRef FROM reservation_custom_options WHERE reservationId = ?').all(id);
const complement = (id) => Number(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount);

// Each case on its own evening hour: the cases share one database, and a slot sold once is taken.
async function placeTwoBaths(ctx, bathStart, saunaSessions) {
  const end = `${String(Number(bathStart.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  const lines = [
    { kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: bathStart, end }] },
    { kind: 'resource', id: SAUNA, sessions: saunaSessions },
  ];
  const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  return placed.body.data.orderId;
}

test('A3-1 — removing the unsupplemented bath of an order keeps the other bath\'s evening supplement: the complement keeps its 10 €', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const orderId = await placeTwoBaths(ctx, '19:00', [{ date: isoPlus(6), start: '10:00', end: '11:00' }]);
    const supplement = customs(stayId);
    assert.equal(supplement.length, 1);
    assert.equal(supplement[0].fulfilmentRef, `evening:resource:${BATH}`);
    assert.equal(complement(stayId), 35);
    const out = await ctx.call('POST', `/api/guest-app/orders/${orderId}/amend`, { lines: [{ key: `res:${SAUNA}`, quantity: 0 }] });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.deepEqual(customs(stayId), supplement);
    assert.equal(complement(stayId), 10);
  } finally { await ctx.close(); }
});

test('A3-1 — taking one session off the unsupplemented bath is accepted (not « supplementWhole »): the supplement stays whole', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const orderId = await placeTwoBaths(ctx, '20:00', [{ date: isoPlus(6), start: '12:00', end: '13:00' }, { date: isoPlus(7), start: '12:00', end: '13:00' }]);
    assert.equal(complement(stayId), 60);
    const out = await ctx.call('POST', `/api/guest-app/orders/${orderId}/amend`, { removeSessions: [{ resourceId: SAUNA, date: isoPlus(7), start: '12:00' }] });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(customs(stayId).length, 1);
    assert.equal(complement(stayId), 35);
  } finally { await ctx.close(); }
});

test('A3-1 — removing the supplemented bath of a two-bath order removes its supplement with it, the other bath stays billed', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const orderId = await placeTwoBaths(ctx, '21:00', [{ date: isoPlus(6), start: '14:00', end: '15:00' }]);
    const out = await ctx.call('POST', `/api/guest-app/orders/${orderId}/amend`, { lines: [{ key: `res:${BATH}`, quantity: 0 }] });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.deepEqual(customs(stayId), []);
    assert.equal(complement(stayId), 25);
  } finally { await ctx.close(); }
});
