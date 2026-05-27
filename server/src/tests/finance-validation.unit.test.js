const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateMoneyAmount,
  validatePercentage,
  validateFinanceInputs,
  ERROR_NOT_A_NUMBER,
  ERROR_NEGATIVE_AMOUNT,
  ERROR_INVALID_PERCENTAGE,
} = require('../utils/financeValidation');

test('validateMoneyAmount: empty/null/undefined are accepted (optional field)', () => {
  assert.equal(validateMoneyAmount(''), null);
  assert.equal(validateMoneyAmount(null), null);
  assert.equal(validateMoneyAmount(undefined), null);
});

test('validateMoneyAmount: valid non-negative numbers pass', () => {
  assert.equal(validateMoneyAmount(0), null);
  assert.equal(validateMoneyAmount(120.5), null);
  assert.equal(validateMoneyAmount('99.99'), null);
});

test('validateMoneyAmount: rejects negative and non-finite', () => {
  assert.equal(validateMoneyAmount(-1), ERROR_NEGATIVE_AMOUNT);
  assert.equal(validateMoneyAmount('-0.01'), ERROR_NEGATIVE_AMOUNT);
  assert.equal(validateMoneyAmount('abc'), ERROR_NOT_A_NUMBER);
  assert.equal(validateMoneyAmount(NaN), ERROR_NOT_A_NUMBER);
  assert.equal(validateMoneyAmount(Infinity), ERROR_NOT_A_NUMBER);
});

test('validatePercentage: accepts 0..100 and empty', () => {
  assert.equal(validatePercentage(''), null);
  assert.equal(validatePercentage(0), null);
  assert.equal(validatePercentage(50), null);
  assert.equal(validatePercentage(100), null);
});

test('validatePercentage: rejects out-of-range and non-finite', () => {
  assert.equal(validatePercentage(-1), ERROR_INVALID_PERCENTAGE);
  assert.equal(validatePercentage(101), ERROR_INVALID_PERCENTAGE);
  assert.equal(validatePercentage('xyz'), ERROR_NOT_A_NUMBER);
});

test('validateFinanceInputs: returns first error or null', () => {
  assert.equal(
    validateFinanceInputs({
      customPrice: { value: 100, kind: 'money' },
      discountPercent: { value: 10, kind: 'percentage' },
    }),
    null
  );
  assert.equal(
    validateFinanceInputs({
      customPrice: { value: -5, kind: 'money' },
      discountPercent: { value: 10, kind: 'percentage' },
    }),
    ERROR_NEGATIVE_AMOUNT
  );
  assert.equal(
    validateFinanceInputs({
      discountPercent: { value: 150, kind: 'percentage' },
    }),
    ERROR_INVALID_PERCENTAGE
  );
});
