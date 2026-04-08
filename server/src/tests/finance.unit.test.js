const test = require('node:test');
const assert = require('node:assert/strict');

const financeRoute = require('../routes/finance');

const {
  getMonthBounds,
  getLastNightDate,
  isReservationAssignedToMonth,
  computeAccommodationAmountAfterDiscount,
  computeTouristTaxAmount,
} = financeRoute.__test;

test('getMonthBounds returns correct month boundaries', () => {
  const bounds = getMonthBounds('2026-03');
  assert.deepEqual(bounds, { start: '2026-03-01', endExclusive: '2026-04-01' });
});

test('getMonthBounds rejects invalid formats', () => {
  assert.equal(getMonthBounds('2026-3'), null);
  assert.equal(getMonthBounds('bad-value'), null);
  assert.equal(getMonthBounds('2026-13'), null);
});

test('computeAccommodationAmountAfterDiscount allocates discount proportionally to accommodation', () => {
  const result = computeAccommodationAmountAfterDiscount({
    accommodationRawAmount: 1000,
    optionsTotal: 200,
    resourcesTotal: 100,
    finalPrice: 1100,
  });

  assert.equal(result.accommodationRawAmount, 1000);
  assert.equal(result.reductionAmount, 200);
  assert.equal(result.accommodationAmount, 846.15);
});

test('computeAccommodationAmountAfterDiscount keeps accommodation unchanged when no reduction', () => {
  const result = computeAccommodationAmountAfterDiscount({
    accommodationRawAmount: 450,
    optionsTotal: 50,
    resourcesTotal: 0,
    finalPrice: 500,
  });

  assert.equal(result.reductionAmount, 0);
  assert.equal(result.accommodationAmount, 450);
});

test('computeTouristTaxAmount computes adult-nights and rounds tax amount', () => {
  const result = computeTouristTaxAmount({ nightsCount: 7, adults: 2, taxRate: 1.234 });
  assert.equal(result.adultNights, 14);
  assert.equal(result.taxAmount, 17.28);
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
