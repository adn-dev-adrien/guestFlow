// specs/google-vacation-rentals-feed.md rules 4 and 8 — what is priced: arrivals over the horizon,
// lengths up to maxLos and never past the horizon, party sizes only where the total can change.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addDays, arrivalDates, lengthsFor, partySizes, enumerate, itineraryKey,
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

test('rule 4 — every party size from 1 to the cap, whatever the tourist tax (2026-10-27 audit)', () => {
  const gite = { basePriceIncludedGuests: 10, touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1.2 };
  assert.deepEqual(partySizes(gite, 14), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  // No headcount tax: a per-person default option still makes a party of 1 cheaper than the 4 included.
  const flat = { basePriceIncludedGuests: 4, touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 0 };
  assert.deepEqual(partySizes(flat, 6), [1, 2, 3, 4, 5, 6]);
  const fixed = { basePriceIncludedGuests: 2, touristTaxMode: 'fixed_amount', touristTaxFixedAmount: 10 };
  assert.deepEqual(partySizes(fixed, 4), [1, 2, 3, 4]);
});

test('edge case — a party above the cap is never priced; an included count above the cap is clamped', () => {
  assert.deepEqual(partySizes({ basePriceIncludedGuests: 8 }, 4), [1, 2, 3, 4]);
  assert.deepEqual(partySizes({ basePriceIncludedGuests: 0 }, 0), [1]);
});

test('enumerate walks the whole space, arrival-major, with stable keys', () => {
  const all = enumerate({ today: '2027-03-01', horizonDays: 3, maxLos: 2, sizes: [1, 2] });
  // Arrivals 1, 2, 3 March; the last one fits one night only.
  assert.equal(all.length, 2 * 2 + 2 * 2 + 1 * 2);
  assert.deepEqual(all[0], { checkin: '2027-03-01', nights: 1, guests: 1 });
  assert.equal(itineraryKey(all[all.length - 1]), '2027-03-03|1|2');
});
