// specs/guest-app.md rules 81, 82, 92 and specs/pricing-components.md rules 24, 90.3 (review defect D8, M1) — the bath's evening is billed ONE way: the offered evening hour
// owes its supplement as part of the session line (quote = commit), and the arrival SAS's own recompute does not bill that evening a second time.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, hasHourly, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { optionalPlugin, skipWithout } = require('../../sdk/testing');

const BATH = addBath({ id: 3891, freeMinutes: { 1: 60 } });
sell('resource', BATH);
db.prepare('UPDATE resources SET hourlyEveningStart = ?, hourlyEveningRate = 40, showsPlanningCard = 1 WHERE id = ?').run('19:00', BATH);

test('rule 81 — the offered hour in the evening: 10 € of supplement as a line of its own, quoted = written, never billed again by the SAS recompute', { skip: skipWithout(['hourly-resources']) }, async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '20:00', end: '21:00' }] }];
    const quoted = await ctx.call('POST', '/public/v1/guest/orders/quote', { lines });
    assert.equal(quoted.body.data.total, 10);
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    const supplement = db.prepare('SELECT description, amount, orderRef FROM reservation_custom_options WHERE reservationId = ?').get(stayId);
    assert.deepEqual([supplement.description, supplement.amount, supplement.orderRef.startsWith('order:')], ['Bain nordique — supplément soirée', 10, true], 'the supplement is a line of the stay tagged with its order');
    assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(stayId).complementAmount, 10);
    const model = optionalPlugin(() => require('../../hourly-resources/schedulingModel')).create(db);
    const reservation = require('../../../models/reservationsModel').getByIdWithDetails(stayId);
    assert.deepEqual(model.storedSupplements(reservation), [], 'the SAS has nothing more to bill for that evening');
  } finally { await ctx.close(); }
});
