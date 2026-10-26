// specs/google-vacation-rentals-feed.md rules 4 and 8 — what is priced: arrivals over the horizon,
// lengths up to maxLos and never past the horizon, party sizes only where the total can change.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addDays, arrivalDates, lengthsFor, partySizes, taxDependsOnHeadcount, enumerate, itineraryKey,
} = require('../itineraries');

test('arrivals run from today over horizonDays, across a month and a year end', () => {
  const dates = arrivalDates('2026-12-30', 4);
  assert.deepEqual(dates, ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('rule 4 — stay lengths go up to maxLos; rule 8 — never past the last night of the horizon', () => {
  const horizonEnd = addDays('2027-01-01', 365);
  assert.deepEqual(lengthsFor('2027-01-01', { maxLos: 14, horizonEnd }), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.deepEqual(lengthsFor(addDays(horizonEnd, -3), { maxLos: 14, horizonEnd }), [1, 2, 3]);
  assert.deepEqual(lengthsFor(horizonEnd, { maxLos: 14, horizonEnd }), []);
});

test('rule 4 — a per-adult tourist tax prices every party size up to the cap', () => {
  const gite = { basePriceIncludedGuests: 10, touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1.2 };
  assert.equal(taxDependsOnHeadcount(gite), true);
  assert.deepEqual(partySizes(gite, 14), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

test('rule 4 — without a headcount tax: the included guests, then each extra guest up to the cap', () => {
  const flat = { basePriceIncludedGuests: 4, touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 0 };
  assert.deepEqual(partySizes(flat, 6), [4, 5, 6]);
  const fixed = { basePriceIncludedGuests: 2, touristTaxMode: 'fixed_amount', touristTaxFixedAmount: 10 };
  assert.deepEqual(partySizes(fixed, 4), [2, 3, 4]);
  const percent = { basePriceIncludedGuests: 2, touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5 };
  assert.deepEqual(partySizes(percent, 3), [1, 2, 3], 'the percentage rate is per occupant');
});

test('edge case — a party above the cap is never priced; an included count above the cap is clamped', () => {
  assert.deepEqual(partySizes({ basePriceIncludedGuests: 8 }, 4), [4]);
  assert.deepEqual(partySizes({ basePriceIncludedGuests: 0 }, 0), [1]);
});

test('enumerate walks the whole space, arrival-major, with stable keys', () => {
  const all = enumerate({ today: '2027-03-01', horizonDays: 3, maxLos: 2, sizes: [1, 2] });
  // Arrivals 1, 2, 3 March; the last one fits one night only.
  assert.equal(all.length, 2 * 2 + 2 * 2 + 1 * 2);
  assert.deepEqual(all[0], { checkin: '2027-03-01', nights: 1, guests: 1 });
  assert.equal(itineraryKey(all[all.length - 1]), '2027-03-03|1|2');
});
