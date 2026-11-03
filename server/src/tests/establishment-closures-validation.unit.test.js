const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRange } = require('../utils/establishmentClosuresValidation');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

/** `YYYY-MM-DD`, `days` after today: the dates of this suite hang on it (specs/server-test-isolation.md rule 6). */
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

test('validateRange: valid range returns null', () => {
  assert.equal(validateRange(inDays(-63), inDays(-59)), null);
});

test('validateRange: reversed range returns French error', () => {
  const err = validateRange(inDays(-59), inDays(-63));
  assert.match(err, /postérieure/);
});

test('validateRange: equal start/end is rejected', () => {
  const err = validateRange(inDays(-63), inDays(-63));
  assert.match(err, /postérieure/);
});

test('validateRange: missing start is rejected', () => {
  const err = validateRange('', inDays(-59));
  assert.match(err, /obligatoires/);
});

test('validateRange: missing end is rejected', () => {
  const err = validateRange(inDays(-63), '');
  assert.match(err, /obligatoires/);
});

test('validateRange: both missing is rejected', () => {
  const err = validateRange('', '');
  assert.match(err, /obligatoires/);
});
