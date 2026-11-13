// specs/guest-app.md rules 24, 27 and specs/pricing-components.md rule 10 (review defect D9, L20) — reading the shop is reading: `GET /shop`, the slots and the delivery times run no save
// of the stay (no history entry, no bucket rewritten); only the quote plays one, in a transaction that is rolled back.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, hasHourly, isoPlus, openOrdering, seedStay, sell,
} = fx;
const controller = require('../../../controllers/reservationsController');

const CIDER = addOption({ id: 3901, title: 'Cidre lecture', price: 6 });
sell('option', CIDER);
const BATH = addBath({ id: 391 });
sell('resource', BATH);

test('D9 — the shop, its slots and its delivery times save nothing', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const original = controller.performUpdate;
    let saves = 0;
    controller.performUpdate = (...args) => { saves += 1; return original(...args); };
    try {
      const snapshot = () => JSON.stringify([db.prepare('SELECT * FROM reservations WHERE id = ?').get(stayId), db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(stayId)]);
      const before = snapshot();
      assert.equal((await ctx.call('GET', '/public/v1/guest/shop')).status, 200);
      if (hasHourly) assert.equal((await ctx.call('GET', `/public/v1/guest/shop/resources/${BATH}/slots?from=${isoPlus(6)}&to=${isoPlus(7)}`)).status, 200);
      assert.equal((await ctx.call('POST', '/public/v1/guest/shop/delivery-slots', { lines: [{ kind: 'option', id: CIDER }] })).status, 200);
      assert.equal(saves, 0, 'no save of the stay ran');
      assert.equal(snapshot(), before, 'the stay is exactly as it was');
    } finally { controller.performUpdate = original; }
  } finally { await ctx.close(); }
});
