// specs/pricing-components.md §3 rules 2 and 43 — TIMED OPTIONS (early check-in, late check-out): the unit's own tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { timeToDecimalHour, computeAutoTimedOptionContext, getLateCheckoutNextNightReferencePrice } = require('../utils/pricing/timedOptions');

test('timeToDecimalHour converts half-hour values', () => {
  assert.equal(timeToDecimalHour('15:30'), 15.5);
  assert.equal(timeToDecimalHour('08:00'), 8);
});

test('computeAutoTimedOptionContext computes proportional early check-in hours and price', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 10,
      title: 'Arrivee anticipee',
      autoOptionType: 'early_check_in',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '10:00',
      price: 0,
    },
    checkInTime: '13:00',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 120 }],
  });

  assert.equal(line.optionId, 10);
  assert.equal(line.autoExtraHours, 2);
  assert.equal(line.autoFullNightApplied, false);
  assert.equal(line.totalPrice, 48);
});

test('computeAutoTimedOptionContext applies full-night price for late check-out beyond threshold', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 11,
      title: 'Depart tardif',
      autoOptionType: 'late_check_out',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '17:00',
      price: 0,
    },
    checkOutTime: '17:30',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 120 }, { price: 120 }],
  });

  assert.equal(line.autoExtraHours, 7.5);
  assert.equal(line.autoFullNightApplied, true);
  assert.equal(line.totalPrice, 120);
});

test('computeAutoTimedOptionContext late check-out proportional uses next-night price source', () => {
  const line = computeAutoTimedOptionContext({
    option: {
      id: 12,
      title: 'Depart tardif',
      autoOptionType: 'late_check_out',
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '17:00',
      price: 0,
    },
    checkOutTime: '12:00',
    defaultCheckIn: '15:00',
    defaultCheckOut: '10:00',
    nightlyBreakdown: [{ price: 999 }],
    lateCheckoutNextNightPrice: 120,
  });

  // 2h / 7h (10:00 -> 17:00) of next-night price (120), never from total stay.
  assert.equal(line.autoExtraHours, 2);
  assert.equal(line.autoFullNightApplied, false);
  assert.equal(line.totalPrice, 34.29);
});

test('getLateCheckoutNextNightReferencePrice reads the night after departure from the matching rule', () => {
  const rules = [{ pricingMode: 'fixed', pricePerNight: 120, dateRanges: [], startDate: null, endDate: null }];
  assert.equal(getLateCheckoutNextNightReferencePrice({ rules, endDate: '2027-07-10', stayNights: 2 }), 120); // date-literal-ok: a pure function input, nothing compares it with today
  const progressive = [{ pricingMode: 'progressive', pricePerNight: 100, progressiveTiers: [{ nightNumber: 3, price: 80 }], dateRanges: [], startDate: null, endDate: null }];
  assert.equal(getLateCheckoutNextNightReferencePrice({ rules: progressive, endDate: '2027-07-10', stayNights: 2 }), 40); // date-literal-ok: a pure function input, nothing compares it with today
});

test('computeAutoTimedOptionContext returns null when the option is off or the time is the default one', () => {
  const option = { id: 1, autoOptionType: 'early_check_in', autoEnabled: 1, price: 10 };
  assert.equal(computeAutoTimedOptionContext({ option: { ...option, autoEnabled: 0 }, checkInTime: '12:00', defaultCheckIn: '15:00' }), null);
  assert.equal(computeAutoTimedOptionContext({ option, checkInTime: '15:00', defaultCheckIn: '15:00' }), null);
});

// specs/pricing-components.md §3 rule 44 and the left-open item of verify-pr-a (Q-B19): the resolver reads `H:MM[:SS]`, so
// the timed options do too; prod holds no such time (0 rows), so no stored price moves.
test('timeToDecimalHour reads H:MM and HH:MM:SS like the stay clock resolver', () => {
  assert.equal(timeToDecimalHour('09:00:00', 15), 9);
  assert.equal(timeToDecimalHour('9:30', 15), 9.5);
  assert.equal(timeToDecimalHour('17:45:59', 0), 17.75);
  assert.equal(timeToDecimalHour('24:00', 15), 15, 'not a time of day: the fallback');
  assert.equal(timeToDecimalHour('abc', 10), 10);
});

test('the devis helpers share the one timeToDecimalHour (rule 65)', () => {
  assert.equal(require('../utils/devisHelpers').timeToDecimalHour, timeToDecimalHour);
});
