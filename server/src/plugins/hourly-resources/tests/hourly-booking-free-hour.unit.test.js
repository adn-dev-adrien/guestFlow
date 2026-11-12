// specs/pricing-components.md §3 rules 24, 37 and 83 (class E4, diff 4) — the lodging's free hour is worth the DAY rate on a booking, as on a stay's
// quantity path; the offered minutes right after it keep the band they fall in. Only a booking whose free hour reaches the evening differs.
// Rule 83 (owner, 2026-11-12) — the new valuation applies to NEW bookings only: a booking stored before it keeps its stored price and breakdown
// until the operator moves its slot or its party.
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceBookingLines } = require('../bookingPricing');
const { bookingDeductions, slotPrice, priceRange } = require('../hourlyPricing');
const { seed, DAY } = require('./standaloneBookingFixture');

const resource = {
  priceType: 'per_hour', showsPlanningCard: 1, price: 50, hourlyEveningRate: 70, hourlyEveningStart: '19:00', slotDuration: 30,
};
const price = (startTime, endTime, extra = {}) => priceBookingLines({
  resource, startTime, endTime, override: { price: 50, freeMinutes: 60 }, external: false, ...extra,
});

test('rule 37 — a free hour that starts in the evening is deducted at the day rate: 19:00–21:00 owes 140 − 50, not 140 − 70', () => {
  const out = price('19:00', '21:00');
  assert.deepEqual([out.grossTotal, out.freeValue, out.total], [140, 50, 90]);
  assert.deepEqual(out.lines.map((l) => [l.key.split(':')[0], l.amount]), [['band', 140], ['free', -50]]);
});

test('rule 37 — a free hour in the day band is unchanged: 18:00–20:00 owes 120 − 50', () => {
  const out = price('18:00', '20:00');
  assert.deepEqual([out.grossTotal, out.freeValue, out.total], [120, 50, 70]);
});

test('rule 37 — a free hour that straddles the switch is still the day rate: 18:30–20:30', () => {
  const out = price('18:30', '20:30');
  assert.deepEqual([out.grossTotal, out.freeValue, out.total], [130, 50, 80]);
});

test('rule 37 — the offered minutes keep the band they fall in, after the free hour', () => {
  const out = price('18:00', '20:00', { offeredMinutes: 30 });
  assert.deepEqual([out.freeValue, out.offeredValue, out.total], [50, 35, 35]);
});

test('rule 24 — the deductions are one function of the grid, and the scheduler asks the same grid for a slot', () => {
  const cfg = { dayRate: 50, eveningRate: 70, eveningStart: '19:00', slotMinutes: 30 };
  assert.deepEqual(bookingDeductions({ start: 19 * 60, freeApplied: 60, offeredApplied: 30 }, cfg), { freeValue: 50, offeredValue: 35 });
  assert.equal(slotPrice('19:00', '19:30', cfg), priceRange('19:00', '19:30', cfg));
  assert.equal(slotPrice('19:00', '19:30', cfg), 35);
});

test('rule 24 — an external booking values its free hour at the external day rate', () => {
  const external = { ...resource, hourlyExternalDayRate: 40, hourlyExternalEveningRate: 60 };
  const out = priceBookingLines({ resource: external, startTime: '19:00', endTime: '21:00', override: { freeMinutes: 60 }, external: true });
  assert.deepEqual([out.grossTotal, out.freeValue, out.total], [120, 40, 80]);
});

// An outside rental 21:00-22:00 at the lodging's 60 free minutes: gross 70 (one evening hour), the free hour is 50 on the day rate, 70 on its band.
const EVENING = { resourceId: null, date: DAY, startTime: '21:00', endTime: '22:00', propertyId: 2, clientName: 'Claire Martin' };
function storedBeforeTheRule() {
  const { db, model, resourceId } = seed();
  const out = model.createBooking({ ...EVENING, resourceId });
  db.prepare('UPDATE resource_bookings SET totalPrice = 0, freeHourAtDayRate = NULL WHERE id = ?').run(out.id);
  return { db, model, resourceId, id: Number(out.id) };
}
const draft = (resourceId, id, extra = {}) => ({ resourceId, bookingId: id, date: DAY, startTime: '21:00', endTime: '22:00', propertyId: 2, ...extra });

test('rule 83 — a NEW booking is priced on the one grid: the evening free hour is worth the day rate, and the row says so', () => {
  const { db, model, resourceId } = seed();
  const out = model.createBooking({ ...EVENING, resourceId });
  assert.equal(out.totalPrice, 20);
  assert.equal(db.prepare('SELECT freeHourAtDayRate AS g FROM resource_bookings WHERE id = ?').get(out.id).g, 1);
  const shown = model.priceBooking(draft(resourceId, out.id));
  assert.deepEqual([shown.freeValue, shown.total], [50, 20]);
});

test('rule 83 — a booking stored before the rule keeps its price and its breakdown: the preview, the stored read and a save of the notes', () => {
  const { db, model, resourceId, id } = storedBeforeTheRule();
  const shown = model.priceBooking(draft(resourceId, id));
  assert.deepEqual([shown.freeValue, shown.total], [70, 0]);
  const row = db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  const read = model.breakdownOf({ resource, startTime: row.startTime, endTime: row.endTime, propertyId: row.propertyId, reservationId: row.reservationId, offeredMinutes: 0, date: row.date, stored: row });
  assert.deepEqual([read.freeValue, read.total], [70, 0]);
  const saved = model.update(id, { notes: 'Serviette', displayedTotal: 0 });
  assert.equal(saved.totalPrice, 0);
  assert.equal(db.prepare('SELECT freeHourAtDayRate AS g FROM resource_bookings WHERE id = ?').get(id).g, null);
});

test('rule 83 — the operator moving the slot of a stored booking puts it on the one grid, for good', () => {
  const { db, model, resourceId, id } = storedBeforeTheRule();
  const moved = model.update(id, { startTime: '20:00', endTime: '21:00' });
  assert.equal(moved.totalPrice, 20);
  const back = model.update(id, { startTime: '21:00', endTime: '22:00' });
  assert.equal(back.totalPrice, 20);
  assert.equal(db.prepare('SELECT freeHourAtDayRate AS g FROM resource_bookings WHERE id = ?').get(id).g, 1);
  assert.deepEqual([model.priceBooking(draft(resourceId, id)).freeValue], [50]);
});

test('rule 83 — moving the party (the lodging) of a stored booking re-prices it on the one grid', () => {
  const { db, model, id } = storedBeforeTheRule();
  db.prepare("INSERT INTO properties (id, name) VALUES (3, 'Autre cabane')").run();
  const moved = model.update(id, { propertyId: 3 });
  assert.equal(moved.totalPrice, 70);
  assert.equal(db.prepare('SELECT freeHourAtDayRate AS g FROM resource_bookings WHERE id = ?').get(id).g, 1);
});

// The same behaviour, as the booking spec states it: specs/resource-booking-pricing-and-invoicing.md rule 51.
