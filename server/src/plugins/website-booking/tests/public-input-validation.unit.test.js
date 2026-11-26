const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAvailabilityQuery, validateStayInput, validateGuest, isValidIsoDate,
} = require('../publicInputValidation');

const TODAY = '2026-06-08';
const HORIZON = '2027-06-08'; // date-literal-ok: the suite runs on its own clock, never the real today

test('isValidIsoDate rejects malformed / impossible dates', () => {
  assert.equal(isValidIsoDate('2026-06-08'), true);
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('08/06/2026'), false);
  assert.equal(isValidIsoDate(''), false);
});

test('validateAvailabilityQuery defaults to today … the booking horizon', () => {
  const r = validateAvailabilityQuery({ todayIso: TODAY, horizonUntil: HORIZON });
  assert.equal(r.ok, true);
  assert.equal(r.value.from, TODAY);
  assert.equal(r.value.to, HORIZON);
});

test('validateAvailabilityQuery rejects inverted range', () => {
  const r = validateAvailabilityQuery({ from: '2026-07-10', to: '2026-07-01', todayIso: TODAY, horizonUntil: HORIZON }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'to'));
});

test('validateAvailabilityQuery never reaches past the horizon: a later end is brought back to it', () => {
  const r = validateAvailabilityQuery({ from: '2027-05-01', to: '2027-09-01', todayIso: TODAY, horizonUntil: HORIZON }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(r.ok, true);
  assert.equal(r.value.to, HORIZON);
});

test('validateAvailabilityQuery refuses a window opening at the horizon or after, with the beyondHorizon reason', () => {
  const r = validateAvailabilityQuery({ from: HORIZON, todayIso: TODAY, horizonUntil: HORIZON });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ field: 'from', issue: 'must be before the booking horizon', reason: 'beyondHorizon', horizonUntil: HORIZON }]);
});

test('validateAvailabilityQuery caps the span at the days between today and the horizon', () => {
  const r = validateAvailabilityQuery({ from: '2025-01-01', to: '2027-06-01', todayIso: TODAY, horizonUntil: HORIZON }); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.equal(r.ok, false);
  assert.match(r.errors[0].issue, /range must not exceed 365 days/);
});

test('validateAvailabilityQuery rejects a bad date format', () => {
  const r = validateAvailabilityQuery({ from: 'nope', todayIso: TODAY, horizonUntil: HORIZON });
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

test('validateStayInput strips EVERY price-influencing field — the public API can never set/adjust/offer a price', () => {
  // A hostile proxy throws the whole pricing arsenal at the boundary. The whitelist must keep
  // ONLY the engine inputs (dates, guests, optionId+quantity). No price, no adjustment, no
  // "offered", no platform, no resources — at any level (specs/site/public-api.md §3 rules 5-6).
  const r = validateStayInput({
    propertyId: 1, startDate: '2026-07-20', endDate: '2026-07-27',
    adults: 2,
    // top-level money/override fields — all forbidden
    customPrice: 999, discountPercent: 80, platform: 'airbnb',
    clientGrossAmount: 1, depositAmount: 0, cautionAmount: 0, finalPrice: 0,
    offeredOptionIds: [7, 8], priceOverride: 1, adjustedPrice: 1,
    selectedResources: [{ resourceId: 3, unitPrice: 0, offered: true }], // wrong key — ignored
    // per-option / per-resource price/offer tampering — must collapse to {id, quantity}
    options: [{ optionId: 7, quantity: 2, offered: true, free: true, unitPrice: 0, price: 0 }],
    resources: [{ resourceId: 4, quantity: 1, unitPrice: 0, offered: true, price: 999 }],
  });
  assert.equal(r.ok, true);
  // the engine input is exactly the safe shape, nothing more (options + resources are id+quantity only)
  assert.deepEqual(Object.keys(r.value).sort(), [
    'adults', 'babies', 'babyBeds', 'checkInTime', 'checkOutTime', 'children', 'endDate',
    'options', 'propertyId', 'resources', 'startDate', 'teens',
  ]);
  assert.deepEqual(r.value.options, [{ optionId: 7, quantity: 2 }], 'option reduced to id+quantity — no offered/free/unitPrice/price');
  assert.deepEqual(r.value.resources, [{ resourceId: 4, quantity: 1 }], 'resource reduced to id+quantity — no price/offered');
  for (const banned of [
    'customPrice', 'discountPercent', 'platform', 'clientGrossAmount', 'depositAmount',
    'cautionAmount', 'finalPrice', 'offeredOptionIds', 'priceOverride', 'adjustedPrice',
    'selectedResources',
  ]) {
    assert.equal(banned in r.value, false, `${banned} must never reach the engine`);
  }
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
  assert.equal(validateGuest({ firstName: 'Marie', lastName: 'Durand', email: 'm@x.fr', phone: '0102030405' }).ok, true);
  const bad = validateGuest({ firstName: 'Marie', email: 'not-an-email' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.field === 'guest.email'));
  assert.ok(bad.errors.some((e) => e.field === 'guest.lastName'));
  assert.ok(bad.errors.some((e) => e.field === 'guest.phone'));
});
