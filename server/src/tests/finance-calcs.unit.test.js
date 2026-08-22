const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTouristTaxBreakdown } = require('../utils/pricing');

const {
  getMonthBounds,
  getLastNightDate,
  isReservationAssignedToMonth,
  computeTouristTaxAmount,
} = require('../utils/financeCalcs');

test('getMonthBounds returns correct month boundaries', () => {
  const bounds = getMonthBounds('2026-03');
  assert.deepEqual(bounds, { start: '2026-03-01', endExclusive: '2026-04-01' });
});

test('getMonthBounds rejects invalid formats', () => {
  assert.equal(getMonthBounds('2026-3'), null);
  assert.equal(getMonthBounds('bad-value'), null);
  assert.equal(getMonthBounds('2026-13'), null);
});

test('computeTouristTaxAmount computes adult-nights and rounds tax amount', () => {
  const result = computeTouristTaxAmount({ nightsCount: 7, adults: 2, taxRate: 1.234 });
  assert.equal(result.adultNights, 14);
  assert.equal(result.taxAmount, 17.28);
});

test('percentage tourist tax uses average HT night rate per occupant and taxes adults only', () => {
  const breakdown = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_accommodation',
    touristTaxPercentage: 5,
    touristTaxDepartmentPercentage: 10,
    nights: 3,
    adults: 5,
    occupants: 10,
    accommodationAmountTtc: 360,
    accommodationVatRate: 20,
  });

  assert.equal(breakdown.touristTaxPricePerNightHt, 100);
  assert.equal(breakdown.touristTaxPerOccupantNightPriceHt, 10);
  assert.equal(breakdown.touristTaxUnitAmount, 0.55);
  assert.equal(breakdown.touristTaxTotal, 8.25);
});

test('cross-month reservation is assigned to next month based on last night only', () => {
  const march = getMonthBounds('2026-03');
  const april = getMonthBounds('2026-04');
  const endDate = '2026-04-02';

  assert.equal(getLastNightDate(endDate), '2026-04-01');
  assert.equal(isReservationAssignedToMonth({ endDate, monthBounds: march }), false);
  assert.equal(isReservationAssignedToMonth({ endDate, monthBounds: april }), true);
});

test('reservation fully inside month stays assigned to that same month', () => {
  const april = getMonthBounds('2026-04');
  const may = getMonthBounds('2026-05');
  const endDate = '2026-04-20';

  assert.equal(getLastNightDate(endDate), '2026-04-19');
  assert.equal(isReservationAssignedToMonth({ endDate, monthBounds: april }), true);
  assert.equal(isReservationAssignedToMonth({ endDate, monthBounds: may }), false);
});
