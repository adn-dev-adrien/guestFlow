// specs/guest-app.md rule 82 and specs/pricing-components.md rules 94, 102 (stabilisation loop t2, N-6) — the evening supplement an order bills names its bath by a
// stable key (`fulfilmentRef = evening:resource:<id>`), and the arrival recompute reads what the orders already billed by that key: a second supplement of
// the stay is written « … (2) » (rule 94), and the bare label read only the first.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { optionalPlugin, skipWithout } = require('../../sdk/testing');

const BATH = addBath({ id: 3892, freeMinutes: { 1: 60 } });
sell('resource', BATH);
db.prepare('UPDATE resources SET hourlyEveningStart = ?, hourlyEveningRate = 40, showsPlanningCard = 1 WHERE id = ?').run('19:00', BATH);

test('N-6 — the order\'s supplement carries its bath\'s key; the recompute sums every supplement of that bath, numbered or not', { skip: skipWithout(['hourly-resources']) }, async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '20:00', end: '21:00' }] }];
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    const supplement = db.prepare('SELECT description, amount, orderRef, fulfilmentRef FROM reservation_custom_options WHERE reservationId = ?').get(stayId);
    assert.deepEqual([supplement.description, supplement.fulfilmentRef], ['Bain nordique — supplément soirée', `evening:resource:${BATH}`]);
    // A second supplement of the same bath, numbered by rule 94 (the shape a second order's evening takes).
    db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, orderRef, fulfilmentRef)
      VALUES (?, 'Bain nordique — supplément soirée (2)', 10, 0, 9, 1, 'order:99:1', ?)`).run(stayId, `evening:resource:${BATH}`);
    const model = optionalPlugin(() => require('../../hourly-resources/schedulingModel')).create(db);
    const reservation = require('../../../models/reservationsModel').getByIdWithDetails(stayId);
    const entry = model.soldSchedulableResources(reservation).find((e) => Number(e.resource.id) === BATH);
    assert.equal(entry.orderCharged, 20, 'both supplements of the bath are read, the numbered one included');
  } finally { await ctx.close(); }
});
