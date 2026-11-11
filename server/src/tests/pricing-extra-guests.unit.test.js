// specs/pricing-components.md §3 rules 1, 2 and 6 — EXTRA GUESTS alone: the supplement per stay and per night (season
// override, tier table, ratio of a discounted night, sold nights replayed) and the split between the platform's
// brut and the complement. No DB, plain objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const extraGuests = require('../utils/pricing/extraGuests');
const pricing = require('../utils/pricing');

const { computeExtraGuestSurcharge, splitExtraGuestCount } = extraGuests;
const season = { label: 'Haute', pricePerNight: 100, dateRanges: [{ startDate: '2027-07-01', endDate: '2027-07-31' }] }; // date-literal-ok: pure date arithmetic, nothing compares with today
const nightsOf = (prices) => prices.map((price, i) => ({ date: `2027-07-0${i + 1}`, price }));

test('rule 6 — pricing.js re-exports the very functions of EXTRA GUESTS', () => {
  assert.equal(pricing.computeExtraGuestSurcharge, computeExtraGuestSurcharge);
  assert.equal(pricing.splitExtraGuestCount, splitExtraGuestCount);
});

test('rule 1 — per stay: a flat count × unit price, rounded to the cent', () => {
  assert.deepEqual(computeExtraGuestSurcharge({ unit: 'per_stay', extraGuestCount: 2, propertyUnitPrice: 15.255 }), { total: 30.51, ratioTotal: null, unit: 'per_stay' });
  assert.equal(computeExtraGuestSurcharge({ extraGuestCount: 0, propertyUnitPrice: 20 }).total, 0);
  assert.equal(computeExtraGuestSurcharge({ unit: 'per_stay', extraGuestCount: -3, propertyUnitPrice: 20 }).total, 0);
});

test('rule 1 — per night: each night carries count × unit × (its price ÷ its season full price)', () => {
  const full = computeExtraGuestSurcharge({
    unit: 'per_night', extraGuestCount: 2, propertyUnitPrice: 10, rules: [season], nightlyBreakdown: nightsOf([100, 100, 100]),
  });
  assert.equal(full.total, 60);
  assert.equal(full.ratioTotal, 3);
  const discounted = computeExtraGuestSurcharge({
    unit: 'per_night', extraGuestCount: 2, propertyUnitPrice: 10, rules: [season], nightlyBreakdown: nightsOf([70, 100]),
  });
  assert.equal(discounted.total, 34);
  assert.equal(discounted.ratioTotal, 1.7);
});

test('rule 1 — a season override of the unit price wins over the property unit', () => {
  const overridden = { ...season, extraGuestPrice: 25 };
  const quote = computeExtraGuestSurcharge({
    unit: 'per_night', extraGuestCount: 1, propertyUnitPrice: 10, rules: [overridden], nightlyBreakdown: nightsOf([100, 100]),
  });
  assert.equal(quote.total, 50);
});

test('rule 1 — a tier table prices the night by its rank in the stay and does not compose with the ratio', () => {
  const tiered = { ...season, extraGuestTiers: [{ fromNight: 1, price: 12 }, { fromNight: 2, price: 8 }] };
  const quote = computeExtraGuestSurcharge({
    unit: 'per_night', extraGuestCount: 2, propertyUnitPrice: 10, rules: [tiered], nightlyBreakdown: nightsOf([70, 70]),
  });
  assert.equal(quote.total, 40);
  assert.equal(quote.ratioTotal, 2);
  assert.ok(quote.tiers);
});

test('rule 1 — a sold night replays the season it was sold under, not the live one', () => {
  const quote = computeExtraGuestSurcharge({
    unit: 'per_night', extraGuestCount: 1, propertyUnitPrice: 10, rules: [season],
    nightlyBreakdown: nightsOf([100]), lockedNights: { '2027-07-01': { base: 200, unit: 30 } }, lockedDates: new Set(['2027-07-01']), lockedTiers: [], // date-literal-ok: pure date arithmetic, nothing compares with today
  });
  assert.equal(quote.total, 15);
});

test('rule 1 — per night without nights costs nothing', () => {
  assert.deepEqual(computeExtraGuestSurcharge({ unit: 'per_night', extraGuestCount: 3, propertyUnitPrice: 10, nightlyBreakdown: [] }), { total: 0, ratioTotal: 0, unit: 'per_night' });
});

test('rule 70 — splitExtraGuestCount: guests above both the free count and what the platform billed go to the complement', () => {
  assert.deepEqual(splitExtraGuestCount({ persons: 6, includedGuests: 4, paidGuests: 5 }), { complementGuests: 1, inBrutGuests: 1 });
  assert.deepEqual(splitExtraGuestCount({ persons: 6, includedGuests: 4, paidGuests: null }), { complementGuests: 0, inBrutGuests: 2 });
  assert.deepEqual(splitExtraGuestCount({ persons: 3, includedGuests: 4, paidGuests: 2 }), { complementGuests: 0, inBrutGuests: 0 });
  assert.deepEqual(splitExtraGuestCount({ persons: 6, includedGuests: 4, paidGuests: 6 }), { complementGuests: 0, inBrutGuests: 2 });
});
