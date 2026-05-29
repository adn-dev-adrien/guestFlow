const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveCommissionAmount } = require('../models/reservationsModel').__test;

// `commissionAmount` is the derived field served alongside each reservation: gross − net (≥ 0),
// only for platform-sourced reservations with a recorded clientGrossAmount.

test('direct booking → null (no commission concept)', () => {
  assert.equal(deriveCommissionAmount({ platform: 'direct', clientGrossAmount: 130, finalPrice: 100 }), null);
});

test('platform booking with no gross recorded → null (not yet known)', () => {
  assert.equal(deriveCommissionAmount({ platform: 'airbnb', clientGrossAmount: null, finalPrice: 100 }), null);
});

test('platform booking: commission = gross − net, rounded to 2 decimals', () => {
  assert.equal(deriveCommissionAmount({ platform: 'airbnb', clientGrossAmount: 130, finalPrice: 100 }), 30);
  assert.equal(deriveCommissionAmount({ platform: 'booking', clientGrossAmount: 117.345, finalPrice: 100 }), 17.35);
});

test('gross equal to net → 0 (legitimate, no commission)', () => {
  assert.equal(deriveCommissionAmount({ platform: 'airbnb', clientGrossAmount: 100, finalPrice: 100 }), 0);
});

test('clamped at 0 if gross < net (defensive — should be rejected at the write boundary)', () => {
  assert.equal(deriveCommissionAmount({ platform: 'airbnb', clientGrossAmount: 90, finalPrice: 100 }), 0);
});

test('platform comparison is case-insensitive', () => {
  assert.equal(deriveCommissionAmount({ platform: 'DIRECT', clientGrossAmount: 130, finalPrice: 100 }), null);
});

test('null/empty input → null', () => {
  assert.equal(deriveCommissionAmount(null), null);
  assert.equal(deriveCommissionAmount({}), null);
});
