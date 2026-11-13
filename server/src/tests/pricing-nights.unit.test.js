// specs/pricing-components.md §3 rules 1, 2, 6 and 7 — NIGHTS alone: seasons by date range, progressive nights,
// min / max nights per range, unpriced nights, the locked-nights merge, ISO day arithmetic. No DB, plain objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const nights = require('../utils/pricing/nights');
const pricing = require('../utils/pricing');

const high = { label: 'Haute', pricePerNight: 150, minNights: 3, dateRanges: [{ startDate: '2027-07-01', endDate: '2027-08-31' }] }; // date-literal-ok: pure date arithmetic, nothing compares with today
const low = { label: 'Basse', pricePerNight: 90, dateRanges: [{ startDate: '2027-01-01', endDate: '2027-06-30', minNights: 2, maxNights: 14 }] }; // date-literal-ok: pure date arithmetic, nothing compares with today

test('rule 7 — a stay across two seasons prices each night at its season and totals to the cent', () => {
  const quote = nights.calculateBaseStayPrice([low, high], '2027-06-29', '2027-07-02'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(quote.nights, 3);
  assert.deepEqual(quote.nightlyBreakdown.map((n) => [n.date, n.price, n.seasonLabel]), [
    ['2027-06-29', 90, 'Basse'], ['2027-06-30', 90, 'Basse'], ['2027-07-01', 150, 'Haute'], // date-literal-ok: pure date arithmetic, nothing compares with today
  ]);
  assert.equal(quote.totalPrice, 330);
  assert.deepEqual(quote.unpricedNights, []);
});

test('rule 7 — the minimum is the most restrictive per-night value, the range override beating the season', () => {
  const quote = nights.calculateBaseStayPrice([low, high], '2027-06-29', '2027-07-02'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(quote.requiredMinNights, 3);
  assert.equal(quote.minNightsBreached, false);
  const short = nights.calculateBaseStayPrice([low, high], '2027-03-01', '2027-03-02'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(short.requiredMinNights, 2);
  assert.equal(short.minNightsBreached, true);
  assert.deepEqual(short.minNightsRules, [{ label: 'Basse', minNights: 2 }]);
});

test('rule 7 — a ceiling applies per range and a longer stay breaches it', () => {
  const long = nights.calculateBaseStayPrice([low], '2027-03-01', '2027-03-20'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(long.requiredMaxNights, 14);
  assert.equal(long.maxNightsBreached, true);
  assert.deepEqual(long.maxNightsRules, [{ label: 'Basse', maxNights: 14 }]);
  assert.equal(nights.calculateBaseStayPrice([high], '2027-07-05', '2027-07-08').requiredMaxNights, null); // date-literal-ok: pure date arithmetic, nothing compares with today
});

test('rule 7 — nights no season covers keep the 100 € fallback and are named', () => {
  const quote = nights.calculateBaseStayPrice([high], '2027-05-01', '2027-05-03'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.deepEqual(quote.unpricedNights, ['2027-05-01', '2027-05-02']); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(quote.totalPrice, 200);
  assert.equal(nights.hasUnpricedNights(quote), true);
  assert.equal(nights.hasUnpricedNights({ unpricedNights: [] }), false);
  assert.equal(nights.hasUnpricedNights(null), false);
});

test('rule 7 — a zero or negative stay prices nothing', () => {
  const quote = nights.calculateBaseStayPrice([high], '2027-07-05', '2027-07-05'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(quote.nights, 0);
  assert.equal(quote.totalPrice, 0);
  assert.equal(quote.requiredMinNights, 1);
  assert.equal(nights.calculateBaseStayPrice([high], '2027-07-08', '2027-07-05').nights, 0); // date-literal-ok: pure date arithmetic, nothing compares with today
});

test('rule 7 — a progressive season prices the nights after the first from its tiers, the last tier carrying forward', () => {
  const progressive = {
    label: 'Prog', pricePerNight: 100, pricingMode: 'progressive',
    progressiveTiers: [{ nightNumber: 2, extraNightPrice: 80 }, { nightNumber: 3, extraNightPrice: 60 }],
    dateRanges: [{ startDate: '2027-01-01', endDate: '2027-12-31' }], // date-literal-ok: pure date arithmetic, nothing compares with today
  };
  const quote = nights.calculateBaseStayPrice([progressive], '2027-02-01', '2027-02-06'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.deepEqual(quote.nightlyBreakdown.map((n) => n.price), [100, 80, 60, 60, 60]);
  assert.ok(quote.nightlyBreakdown.every((n) => n.pricingMode === 'progressive'));
  assert.equal(quote.totalPrice, 360);
  assert.equal(nights.getProgressiveExtraNightPrice(progressive, 2, 100), 80);
});

test('rule 7 — mergeNightlyBreakdownWithLocked keeps the nights already sold at their sold price, same arrival only', () => {
  const locked = [{ date: '2027-07-01', price: 120, nightNumber: 1, seasonLabel: 'Haute' }]; // date-literal-ok: pure date arithmetic, nothing compares with today
  const fresh = [
    { date: '2027-07-01', price: 150, nightNumber: 1, seasonLabel: 'Haute' }, // date-literal-ok: pure date arithmetic, nothing compares with today
    { date: '2027-07-02', price: 150, nightNumber: 2, seasonLabel: 'Haute' }, // date-literal-ok: pure date arithmetic, nothing compares with today
  ];
  const merged = nights.mergeNightlyBreakdownWithLocked(locked, fresh);
  assert.deepEqual(merged.nightlyBreakdown.map((n) => n.price), [120, 150]);
  assert.equal(merged.totalPrice, 270);
  assert.deepEqual([...merged.lockedDates], ['2027-07-01']); // date-literal-ok: pure date arithmetic, nothing compares with today
  const moved = nights.mergeNightlyBreakdownWithLocked(locked, fresh.slice(1));
  assert.deepEqual(moved.nightlyBreakdown.map((n) => n.price), [150], 'an arrival that moved locks nothing');
  assert.equal(nights.mergeNightlyBreakdownWithLocked(null, null).totalPrice, 0);
});

test('rule 6 — pricing.js re-exports the very functions of NIGHTS', () => {
  for (const name of ['calculateBaseStayPrice', 'parseJsonArray', 'matchNightRule', 'hasUnpricedNights', 'effectiveMinNightsForDate', 'getRuleNightBaseForDate', 'addDaysToIsoDate']) {
    assert.equal(pricing[name], nights[name], name);
  }
});

test('rule 2 — ISO day arithmetic and range normalisation', () => {
  assert.equal(nights.addDaysToIsoDate('2027-02-28', 1), '2027-03-01'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(nights.addDaysToIsoDate('2028-02-28', 1), '2028-02-29'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(nights.diffIsoDatesInDays('2027-01-30', '2027-02-02'), 3); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.deepEqual(nights.parseJsonArray('[1,2]'), [1, 2]);
  assert.deepEqual(nights.parseJsonArray('{"a":1}'), []);
  assert.deepEqual(nights.parseJsonArray('nope'), []);
  const ranges = nights.normalizeDateRanges([
    { startDate: '2027-07-01', endDate: '2027-07-10', minNights: '4', changeoverArrival: 6 }, // date-literal-ok: pure date arithmetic, nothing compares with today
    { startDate: '2027-01-01', endDate: '2027-01-10', minNights: 0 }, // date-literal-ok: pure date arithmetic, nothing compares with today
    { startDate: '', endDate: '2027-01-10' }, // date-literal-ok: pure date arithmetic, nothing compares with today
  ]);
  assert.deepEqual(ranges.map((r) => r.startDate), ['2027-01-01', '2027-07-01']); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(ranges[0].minNights, undefined);
  assert.equal(ranges[1].minNights, 4);
  assert.equal(ranges[1].changeoverArrival, 6);
  assert.deepEqual(nights.getBoundsFromDateRanges(ranges), { startDate: '2027-01-01', endDate: '2027-07-10' }); // date-literal-ok: pure date arithmetic, nothing compares with today
});

test('rule 7 — the weekly model: a short stay takes its share of the weekly price, beyond a week the pro-rata', () => {
  assert.equal(nights.getWeekPriceEquivalent(100), 400);
  assert.equal(nights.calculateStayPrice(700, 1), 175);
  assert.equal(nights.calculateStayPrice(700, 7), 700);
  assert.equal(nights.calculateStayPrice(700, 10), 1000);
});
