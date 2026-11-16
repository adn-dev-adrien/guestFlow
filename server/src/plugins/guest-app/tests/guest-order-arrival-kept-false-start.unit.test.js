// specs/guest-app.md rule 110 a, specs/pricing-components.md rule 103 (stabilisation loop t4, A4-1, 2026-11-16) — one judge of « the order is still
// changed at the door »: a stay whose false start was kept (a baseline stored, the arrival unticked before the check-in hour, nothing collected)
// already carves its sales out to the departure, so the arrival SAS shows the app order read-only and the sale refuses `atArrival` with words that
// say what happened (never « Arrivée déjà validée »). From the check-in hour the clock has started and the order is changed at the door again.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, db, isoPlus, openOrdering, seedStay, sell } = fx;
const reservations = require('../../../models/reservationsModel');
const extraSale = require('../../../utils/extraSale');
const stayClock = require('../../../models/stayClockModel');

const PERRY = addOption({ id: 9981, title: 'Poiré fermier', price: 6 });
sell('option', PERRY, { maxQuantity: 5 });
const at = (time) => new Date(`${isoPlus(5)}T${time}:00+01:00`);

test('A4-1 — a kept false start before the hour: the order is read-only at the SAS and the sale refuses the door with its own words', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PERRY, quantity: 2 }], payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    ctx.clock.now = at('10:00');
    db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(stayId);
    const baseline = stayClock.withNow(at('10:00'), () => reservations.resolveArrivalExtrasBaseline(stayId));
    assert.ok(baseline, 'the tick lays a baseline');
    db.prepare('UPDATE reservations SET checkInDone = 0, arrivalExtrasBaseline = ? WHERE id = ?').run(baseline, stayId);
    ctx.clock.now = at('11:00');
    assert.equal(extraSale.arrivalOpenAt(stayId, ctx.clock.now), false);
    assert.equal(ctx.api.ordersAtArrival(stayId).orders[0].editable, false);
    const refused = extraSale.quote(stayId, [{ articleRef: `option:${PERRY}`, quantity: 1 }], { now: ctx.clock.now, atArrival: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'ARRIVAL_CLOSED');
    assert.doesNotMatch(refused.body.error, /validée/);
    ctx.clock.now = at('16:30');
    assert.equal(extraSale.arrivalOpenAt(stayId, ctx.clock.now), true);
    assert.equal(ctx.api.ordersAtArrival(stayId).orders[0].editable, true);
  } finally { await ctx.close(); }
});
