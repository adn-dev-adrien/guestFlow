const test = require('node:test');
const assert = require('node:assert/strict');

const { eveningSupplement, priceRange } = require('../hourlyPricing');

// specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 22 — the hours are SOLD at the day
// rate on the devis. Placing one in the evening band during the arrival SAS owes the difference,
// which lands in the arrival complement instead of re-playing the quote.
// Bain nordique: 30 €/h in the day, 50 €/h from 20:00, 60-min slots.
const BAIN = { dayRate: 30, eveningRate: 50, eveningStart: '20:00', slotMinutes: 60 };

test('a day-only block owes nothing', () => {
  assert.equal(eveningSupplement([{ start: '14:00', end: '16:00' }], BAIN), 0);
});

test('an evening-only block owes the full band difference', () => {
  // 20:00–22:00 = 2 h × (50 − 30)
  assert.equal(eveningSupplement([{ start: '20:00', end: '22:00' }], BAIN), 40);
});

test('a block straddling the switch owes the evening minutes only', () => {
  // 19:00–21:00 = 1 h day (0) + 1 h evening (20)
  assert.equal(eveningSupplement([{ start: '19:00', end: '21:00' }], BAIN), 20);
});

test('the supplement is exactly « banded price − day-only price »', () => {
  const block = { start: '19:00', end: '22:00' };
  const banded = priceRange(block.start, block.end, BAIN);
  const dayOnly = priceRange(block.start, block.end, { dayRate: 30, slotMinutes: 60 });
  assert.equal(eveningSupplement([block], BAIN), Math.round((banded - dayOnly) * 100) / 100);
});

test('half-hour slots are pro-rated on the evening side', () => {
  const halfSlots = { ...BAIN, slotMinutes: 30 };
  // 19:30–20:30 = 30 min day (0) + 30 min evening (0.5 h × 20 = 10)
  assert.equal(eveningSupplement([{ start: '19:30', end: '20:30' }], halfSlots), 10);
});

test('several blocks are summed', () => {
  assert.equal(
    eveningSupplement([
      { start: '14:00', end: '15:00' }, // 0
      { start: '20:00', end: '21:00' }, // 20
      { start: '21:00', end: '22:00' }, // 20
    ], BAIN),
    40,
  );
});

test('no evening band configured → nothing is ever owed', () => {
  assert.equal(eveningSupplement([{ start: '20:00', end: '22:00' }], { dayRate: 30, slotMinutes: 60 }), 0);
  assert.equal(
    eveningSupplement([{ start: '20:00', end: '22:00' }], { dayRate: 30, eveningRate: 0, eveningStart: '20:00', slotMinutes: 60 }),
    0,
  );
});

test('an evening rate cheaper than the day rate never produces a discount', () => {
  const cheapEvening = { dayRate: 50, eveningRate: 30, eveningStart: '20:00', slotMinutes: 60 };
  assert.equal(eveningSupplement([{ start: '20:00', end: '22:00' }], cheapEvening), 0);
  // …and it must not offset another block's genuine supplement either (clamped per block).
  assert.equal(
    eveningSupplement([{ start: '20:00', end: '22:00' }], cheapEvening)
      + eveningSupplement([{ start: '20:00', end: '21:00' }], BAIN),
    20,
  );
});

test('malformed or empty input yields 0, never NaN', () => {
  assert.equal(eveningSupplement([], BAIN), 0);
  assert.equal(eveningSupplement(null, BAIN), 0);
  assert.equal(eveningSupplement([{ start: '21:00', end: '20:00' }], BAIN), 0);
  assert.equal(eveningSupplement([{}], BAIN), 0);
});

// specs/resource-supplements-total-server-side.md §1.2 finding 5 — the supplement the step shows is the
// one the recap bills: what the sold line already bills for the evening is credited.
test('free-slots answers the credited supplement and the hours left to place', () => {
  const { seed } = require('./hourlySchedulingFixture');
  // Sold 2 h for 60,00 at a 25 €/h day rate → 10,00 already billed for the evening.
  const ctx = seed({
    hoursSold: 2,
    resource: { price: 25, hourlyEveningStart: '19:00', hourlyEveningRate: 35, slotDuration: 60 },
  });
  const now = new Date('2026-09-01T09:00:00Z');
  const pending = [
    { date: '2026-09-12', start: '19:00', end: '20:00' },
    { date: '2026-09-12', start: '20:00', end: '21:00' },
  ];
  const answer = ctx.scheduling.getFreeSlots({ reservation: ctx.reservation, resourceId: ctx.resourceId, pending, now });
  assert.equal(answer.supplement, 10);
  assert.equal(answer.hoursRemaining, 0);
  const partial = ctx.scheduling.getFreeSlots({ reservation: ctx.reservation, resourceId: ctx.resourceId, pending: pending.slice(0, 1), now });
  assert.equal(partial.hoursRemaining, 1);
});
