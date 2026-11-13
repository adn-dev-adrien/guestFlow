// specs/guest-app.md rules 98, 105 and specs/pricing-components.md rules 17, 49 (review defect D3, M1 and M2-M4) — on a stay a platform sold, the free hour and the paid hours of the bath are
// ordered from J-7 exactly as on a direct stay: the money grows by the order's own amount, the line is outside the platform price (a sale of the shop, collected at
// the arrival), and what the platform price already contains is a line fact, never a platform name.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, hasHourly, isoPlus, openOrdering, seedStay, sell,
} = fx;

const BATH = addBath({ id: 3851, freeMinutes: { 1: 60 } });
sell('resource', BATH);
const DAY = isoPlus(6);

['direct', 'booking'].forEach((platform, index) => {
  test(`rule 98 — ${platform} stay: the free hour and a paid hour are quoted and written, the line a shop line collected at the arrival`, { skip: !hasHourly }, async () => {
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, platform });
    const ctx = await openOrdering(stayId);
    try {
      const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: DAY, start: `${10 + 4 * index}:00`, end: `${11 + 4 * index}:00` }, { date: DAY, start: `${12 + 4 * index}:00`, end: `${13 + 4 * index}:00` }] }];
      const quote = await ctx.call('POST', '/public/v1/guest/orders/quote', { lines });
      assert.equal(quote.status, 200, JSON.stringify(quote.body));
      assert.equal(quote.body.data.total, 30, 'the first hour is offered, the second at 30 €');
      const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
      assert.equal(placed.status, 200, JSON.stringify(placed.body));
      const line = db.prepare('SELECT source, collectAt, totalPrice FROM reservation_resources WHERE reservationId = ?').get(stayId);
      assert.deepEqual([line.source, line.collectAt, line.totalPrice], ['shop', 'arrival', 30], 'outside the platform price, collected at the arrival');
    } finally { await ctx.close(); }
  });
});
