// specs/guest-app.md rules 93, 95 and 101, specs/pricing-components.md rules 8, 9 (review defect D1, HIGH 1 / HIGH 2) — an order adds its own lines and nothing else: the nights, the
// tourist tax, the stored price and the other lines of the stay stay as they were sold, even when the engine of today would price the stay otherwise.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, optionLine, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 3801, title: 'Cidre figé', price: 6.5 });
sell('option', CIDER);
const stayRow = (id) => db.prepare('SELECT finalPrice, totalPrice, touristTaxTotal, depositAmount, balanceAmount FROM reservations WHERE id = ?').get(id);
const nights = (id) => db.prepare('SELECT date, price FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(id);

test('rule 93 — a stay sold at a price the engine no longer reproduces: the order is charged its own lines, and the tax, the deposit, the balance and the nights stay as sold', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  db.prepare('UPDATE reservations SET finalPrice = 777, totalPrice = 777, balanceAmount = 777, touristTaxTotal = 12 WHERE id = ?').run(stayId);
  const before = { stay: stayRow(stayId), nights: nights(stayId) };
  const ctx = await openOrdering(stayId);
  try {
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    const after = stayRow(stayId);
    assert.equal(db.prepare('SELECT total FROM guest_orders WHERE id = ?').get(placed.body.data.orderId).total, 13, 'the order is charged its own lines, not the drift of the stay\'s price');
    assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(stayId).complementAmount, 13, 'the arrival complement asks exactly the order');
    assert.deepEqual([after.touristTaxTotal, after.depositAmount, after.balanceAmount], [12, before.stay.depositAmount, 777], 'tax, deposit and balance untouched');
    assert.deepEqual(nights(stayId), before.nights, 'the nights are untouched');
    assert.equal(optionLine(stayId, CIDER).totalPrice, 13);
  } finally { await ctx.close(); }
});
