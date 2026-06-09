const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAvailabilityQuery, validateStayInput, validateGuest, isValidIsoDate,
} = require('../utils/publicInputValidation');

const TODAY = '2026-06-08';

test('isValidIsoDate rejects malformed / impossible dates', () => {
  assert.equal(isValidIsoDate('2026-06-08'), true);
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('08/06/2026'), false);
  assert.equal(isValidIsoDate(''), false);
});

test('validateAvailabilityQuery defaults to today … today+12 months', () => {
  const r = validateAvailabilityQuery({ todayIso: TODAY });
  assert.equal(r.ok, true);
  assert.equal(r.value.from, TODAY);
  assert.equal(r.value.to, '2027-06-08');
});

test('validateAvailabilityQuery rejects inverted range', () => {
  const r = validateAvailabilityQuery({ from: '2026-07-10', to: '2026-07-01', todayIso: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'to'));
});

test('validateAvailabilityQuery rejects a window over 365 days', () => {
  const r = validateAvailabilityQuery({ from: '2026-01-01', to: '2027-06-01', todayIso: TODAY });
  assert.equal(r.ok, false);
});

test('validateAvailabilityQuery rejects a bad date format', () => {
  const r = validateAvailabilityQuery({ from: 'nope', todayIso: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'from'));
});

test('validateStayInput accepts a valid stay and whitelists fields', () => {
  const r = validateStayInput({
    propertyId: 1, startDate: '2026-07-20', endDate: '2026-07-27',
    adults: 2, children: 1, options: [{ optionId: 7, quantity: 2 }],
    customPrice: 1, discountPercent: 50, platform: 'airbnb', // forbidden — must be dropped
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.propertyId, 1);
  assert.equal(r.value.adults, 2);
  assert.deepEqual(r.value.options, [{ optionId: 7, quantity: 2 }]);
  assert.equal('customPrice' in r.value, false);
  assert.equal('discountPercent' in r.value, false);
  assert.equal('platform' in r.value, false);
});

test('validateStayInput rejects missing propertyId and bad date order', () => {
  const r = validateStayInput({ startDate: '2026-07-27', endDate: '2026-07-20' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'propertyId'));
  assert.ok(r.errors.some((e) => e.field === 'endDate'));
});

test('validateStayInput rejects negative / non-integer guest counts', () => {
  const r = validateStayInput({ propertyId: 1, startDate: '2026-07-20', endDate: '2026-07-27', adults: -1, children: 1.5 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'adults'));
  assert.ok(r.errors.some((e) => e.field === 'children'));
});

test('validateStayInput rejects a malformed option line', () => {
  const r = validateStayInput({ propertyId: 1, startDate: '2026-07-20', endDate: '2026-07-27', options: [{ quantity: 1 }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field.startsWith('options[0]')));
});

test('validateGuest requires names, a valid email, and a phone', () => {
  assert.equal(validateGuest({ firstName: 'Marie', lastName: 'Durand', email: 'm@x.fr', phone: '0102' }).ok, true);
  const bad = validateGuest({ firstName: 'Marie', email: 'not-an-email' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.field === 'guest.email'));
  assert.ok(bad.errors.some((e) => e.field === 'guest.lastName'));
  assert.ok(bad.errors.some((e) => e.field === 'guest.phone'));
});
