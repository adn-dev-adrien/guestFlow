// specs/guest-app.md rule 104 and specs/pricing-components.md rules 20, 44 (review defect D2, H1) — an order is routed by the stay clock: the arrival date AND the
// check-in time. On the arrival day before the check-in hour it is collected at the arrival; from the hour, at the departure — never by « startDate < today ».
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, isoPlus, openOrdering, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 3811, title: 'Cidre horloge', price: 6 });
sell('option', CIDER);

// The order is placed at a fixed hour of the arrival day (the session and the API clock, `openOrdering`'s `now`), never at the
// wall clock's: the stay clock judges in Paris whatever the process zone (specs/server-test-isolation.md rule 6, reading of
// 2026-11-19). The fixture's check-in is 16:00; 10:00 and 18:00 at +01:00 stay on their side of it in winter and summer time.
async function orderOn(time, fn) {
  const stayId = seedStay({ start: 2, end: 5, checkedIn: 0 });
  const ctx = await openOrdering(stayId, { now: new Date(`${isoPlus(2)}T${time}:00+01:00`) });
  try { await fn({ stayId, ...ctx }); } finally { await ctx.close(); }
}

test('rule 104 — the arrival day before the check-in hour: collected at the arrival', async () => {
  await orderOn('10:00', async ({ stayId, call }) => {
    const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
    assert.equal(shop.orderCollection, 'arrival');
    const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.equal(db.prepare('SELECT collectAt FROM guest_orders WHERE id = ?').get(placed.body.data.orderId).collectAt, 'arrival');
    assert.equal(db.prepare('SELECT collectAt FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(stayId, CIDER).collectAt, 'arrival');
  });
});

test('rule 104 — the arrival day from the check-in hour: collected at the departure', async () => {
  await orderOn('18:00', async ({ stayId, call }) => {
    assert.equal((await call('GET', '/public/v1/guest/shop')).body.data.orderCollection, 'departure');
    const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
    assert.equal(db.prepare('SELECT collectAt FROM guest_orders WHERE id = ?').get(placed.body.data.orderId).collectAt, 'departure');
    assert.equal(db.prepare('SELECT collectAt FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(stayId, CIDER).collectAt, 'departure');
  });
});

test('rule 104 — a stay whose arrival is days ahead orders on the arrival complement', async () => {
  const stayId = seedStay({ start: 6, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    assert.equal((await ctx.call('GET', '/public/v1/guest/shop')).body.data.orderCollection, 'arrival');
    assert.equal(isoPlus(6) > isoPlus(0), true);
  } finally { await ctx.close(); }
});
