// specs/pricing-components.md §3 rules 36 and 37, §5 « Backfill » — the moment a stored line is collected, derived from
// what the stay stores today (`inComplement`, `arrivalExtrasBaseline`, the platform's mode).
const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyCollectAt, keysAboveBaseline } = require('../utils/pricing/legacyCollectAt');

const option = (optionId, totalPrice, inComplement = 0, extra = {}) => ({ optionId, totalPrice, inComplement, offered: 0, ...extra });

test('rule 37: a line outside the complement is collected by the plan on a direct stay and inside the price on a platform stay', () => {
  const lines = [option(1, 20), { resourceId: 2, totalPrice: 40, inComplement: 0, offered: 0 }];
  assert.deepEqual(legacyCollectAt(lines, { platformSale: false }), ['plan', 'plan']);
  assert.deepEqual(legacyCollectAt(lines, { platformSale: true }), ['platform', 'platform']);
});

test('rule 37: a line in the complement is collected at arrival', () => {
  assert.deepEqual(legacyCollectAt([option(1, 20, 1)], {}), ['arrival']);
  assert.deepEqual(legacyCollectAt([option(1, 20, 1)], { platformSale: true }), ['arrival']);
});

test('rule 37: a complement line above the arrival baseline was sold during the stay and is collected at departure', () => {
  const baseline = JSON.stringify({ 'opt:1': 20, 'opt:2': 30 });
  const lines = [option(1, 20, 1), option(2, 50, 1), option(3, 15, 1)];
  assert.deepEqual(legacyCollectAt(lines, { baseline }), ['arrival', 'departure', 'departure']);
});

test('rule 37: the baseline is judged per key, custom lines of the same text being one key, offered and zero lines never above', () => {
  const custom = (description, totalPrice, extra = {}) => ({ isCustom: true, description, totalPrice, inComplement: 1, offered: 0, ...extra });
  const baseline = { 'custom:tisane': 10 };
  const lines = [custom('Tisane', 6), custom(' tisane ', 6), custom('Thé', 0), custom('Miel', 9, { offered: 1 })];
  assert.deepEqual(legacyCollectAt(lines, { baseline }), ['departure', 'departure', 'arrival', 'arrival']);
  assert.deepEqual([...keysAboveBaseline(lines, baseline)], ['custom:tisane']);
});

test('rule 37: without a baseline nothing is above it, and a malformed one reads as none', () => {
  assert.deepEqual(legacyCollectAt([option(1, 20, 1)], { baseline: null }), ['arrival']);
  assert.deepEqual(legacyCollectAt([option(1, 20, 1)], { baseline: 'not json' }), ['arrival']);
  assert.deepEqual(legacyCollectAt([], {}), []);
});
