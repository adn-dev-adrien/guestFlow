const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRange } = require('../utils/establishmentClosuresValidation');

test('validateRange: valid range returns null', () => {
  assert.equal(validateRange('2026-09-01', '2026-09-05'), null);
});

test('validateRange: reversed range returns French error', () => {
  const err = validateRange('2026-09-05', '2026-09-01');
  assert.match(err, /postérieure/);
});

test('validateRange: equal start/end is rejected', () => {
  const err = validateRange('2026-09-01', '2026-09-01');
  assert.match(err, /postérieure/);
});

test('validateRange: missing start is rejected', () => {
  const err = validateRange('', '2026-09-05');
  assert.match(err, /obligatoires/);
});

test('validateRange: missing end is rejected', () => {
  const err = validateRange('2026-09-01', '');
  assert.match(err, /obligatoires/);
});

test('validateRange: both missing is rejected', () => {
  const err = validateRange('', '');
  assert.match(err, /obligatoires/);
});
