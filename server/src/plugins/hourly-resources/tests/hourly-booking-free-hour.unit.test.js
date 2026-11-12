// specs/pricing-components.md §3 rules 24, 37 (class E4, diff 4) — the lodging's free hour is worth the DAY rate on a booking, as on a stay's
// quantity path; the offered minutes right after it keep the band they fall in. Only a booking whose free hour reaches the evening differs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceBookingLines } = require('../bookingPricing');
const { bookingDeductions, slotPrice, priceRange } = require('../hourlyPricing');

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
