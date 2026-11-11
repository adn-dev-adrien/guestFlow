// Review amendments: rule 48 — decimals refused, -0 reads as 0, the payout bound has one source.
// specs/settings-input-guards.md rules 1, 5, 6, 8 — the limits descriptors and the shared parser.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROPERTY_LIMITS, PLATFORM_LIMITS, parseBoundedNumber, limitMessage,
} = require('../utils/inputLimits');

const DAYS = PROPERTY_LIMITS.depositDueDays;
const RATE = PLATFORM_LIMITS.commissionPercent;

test('rule 1: the descriptors carry min, max, integer / decimals and the unit', () => {
  assert.deepEqual(DAYS, { min: 0, max: 30, integer: true, unit: 'jours' });
  assert.equal(PROPERTY_LIMITS.balanceDaysBefore.max, 60);
  assert.equal(PROPERTY_LIMITS.cancelAfterBalanceDueDays.max, 60);
  assert.deepEqual(RATE, { min: 0, max: 99.99, decimals: 2, unit: '%' });
});

test('rule 5: bounds are inclusive and a number outside them is refused, never clamped', () => {
  assert.deepEqual(parseBoundedNumber('0', DAYS), { value: 0 });
  assert.deepEqual(parseBoundedNumber(30, DAYS), { value: 30 });
  assert.deepEqual(parseBoundedNumber('31', DAYS), { error: 'Entre 0 et 30 jours.' });
  assert.deepEqual(parseBoundedNumber('-1', DAYS), { error: 'Entre 0 et 30 jours.' });
  assert.deepEqual(parseBoundedNumber('99.99', RATE), { value: 99.99 });
  assert.deepEqual(parseBoundedNumber('120', RATE), { error: 'Entre 0 et 99,99 %.' });
});

test('rule 5: French and English decimal separators are both read', () => {
  assert.deepEqual(parseBoundedNumber('12,5', RATE), { value: 12.5 });
  assert.deepEqual(parseBoundedNumber('12.5', RATE), { value: 12.5 });
  assert.deepEqual(parseBoundedNumber('12.34', RATE), { value: 12.34 });
});

test('rule 5: a text that is not a number is refused as such', () => {
  for (const raw of ['abc', '1,2,3', '—', '', '   ', null, undefined, '1e3', '5 jours']) {
    assert.deepEqual(parseBoundedNumber(raw, DAYS), { error: 'Nombre attendu.' }, String(raw));
  }
});

test('rule 6: a decimal in a whole-number field is refused', () => {
  assert.deepEqual(parseBoundedNumber('2.5', DAYS), { error: 'Nombre entier de jours.' });
  assert.deepEqual(parseBoundedNumber('2,5', DAYS), { error: 'Nombre entier de jours.' });
  assert.deepEqual(parseBoundedNumber('7.0', DAYS), { value: 7 });
});

test('rule 8: the message is built from the descriptor, a custom message wins', () => {
  assert.equal(limitMessage(DAYS), 'Entre 0 et 30 jours.');
  assert.equal(limitMessage(RATE), 'Entre 0 et 99,99 %.');
  assert.equal(limitMessage(PLATFORM_LIMITS.payoutDueDays), 'Un nombre entier de jours (0 à 365).');
  assert.match(limitMessage(PROPERTY_LIMITS.depositPercent), /^Entre 1 et 99 %\. Pour tout encaisser/);
  assert.equal(limitMessage({ min: 1, max: 5 }), 'Entre 1 et 5.');
});

test('rule 8: the parser and the descriptor agree on every message the client will show', () => {
  assert.equal(parseBoundedNumber('400', PLATFORM_LIMITS.payoutDueDays).error, limitMessage(PLATFORM_LIMITS.payoutDueDays));
  assert.equal(parseBoundedNumber('61', PROPERTY_LIMITS.balanceDaysBefore).error, limitMessage(PROPERTY_LIMITS.balanceDaysBefore));
});

test('rule 5: more decimals than the field holds are refused, never rounded; -0 reads as 0', () => {
  assert.deepEqual(parseBoundedNumber('12.345', RATE), { error: 'Au plus 2 décimales.' });
  assert.deepEqual(parseBoundedNumber('-0.004', RATE), { error: 'Au plus 2 décimales.' });
  assert.ok(Object.is(parseBoundedNumber('-0', RATE).value, 0));
  assert.ok(Object.is(parseBoundedNumber('-0,00', RATE).value, 0));
});

test('rule 8: the payout bound is the one of the payout module', () => {
  assert.equal(PLATFORM_LIMITS.payoutDueDays.max, require('../utils/platformPayout').MAX_PAYOUT_DUE_DAYS);
});
