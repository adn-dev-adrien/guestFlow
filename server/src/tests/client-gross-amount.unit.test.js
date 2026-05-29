const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateClientGrossAmount,
  ERROR_NOT_A_NUMBER,
  ERROR_NEGATIVE_AMOUNT,
  ERROR_GROSS_BELOW_NET,
} = require('../utils/financeValidation');

// Platform gross is what the guest paid the platform (TTC). The owner's net = `finalPrice`. Commission =
// gross − net. A gross below the net implies a negative commission, which we refuse at the write boundary.

test('absent / empty / null gross → valid (field is optional)', () => {
  assert.equal(validateClientGrossAmount(undefined, 100), null);
  assert.equal(validateClientGrossAmount(null, 100), null);
  assert.equal(validateClientGrossAmount('', 100), null);
});

test('non-number gross is rejected (NOT_A_NUMBER)', () => {
  assert.equal(validateClientGrossAmount('abc', 100), ERROR_NOT_A_NUMBER);
  assert.equal(validateClientGrossAmount(NaN, 100), ERROR_NOT_A_NUMBER);
});

test('negative gross is rejected (NEGATIVE_AMOUNT)', () => {
  assert.equal(validateClientGrossAmount(-5, 100), ERROR_NEGATIVE_AMOUNT);
});

test('gross below net is rejected (GROSS_BELOW_NET)', () => {
  assert.equal(validateClientGrossAmount(80, 100), ERROR_GROSS_BELOW_NET);
});

test('gross equal to net is accepted (commission = 0 is legitimate)', () => {
  assert.equal(validateClientGrossAmount(100, 100), null);
});

test('gross greater than net is accepted (the normal case)', () => {
  assert.equal(validateClientGrossAmount(120, 100), null);
  assert.equal(validateClientGrossAmount('150.50', 100), null);
});

test('absent / null net → not checked against gross (only positivity is enforced)', () => {
  assert.equal(validateClientGrossAmount(80, undefined), null);
  assert.equal(validateClientGrossAmount(80, null), null);
  assert.equal(validateClientGrossAmount(-1, undefined), ERROR_NEGATIVE_AMOUNT);
});
