// Shared cleaning-option detection — specs/j1-arrival-reminder-email.md §4.1 + specs/sas-hide-settled-steps.md §3.

const test = require('node:test');
const assert = require('node:assert/strict');

const { isCleaningOption, normalizeOptionName } = require('../utils/cleaningOption');

test('matches by autoOptionType tag', () => {
  assert.equal(isCleaningOption({ title: 'Whatever', autoOptionType: 'cleaning' }), true);
});

test('matches by name « Ménage » even without a tag (hand-created / custom option)', () => {
  assert.equal(isCleaningOption({ title: 'Ménage', autoOptionType: null }), true);
  assert.equal(isCleaningOption({ title: 'Menage', autoOptionType: '' }), true);
  assert.equal(isCleaningOption({ title: 'Ménage de fin de séjour' }), true);
  assert.equal(isCleaningOption({ title: 'Forfait MÉNAGE' }), true);
});

test('does not match a non-cleaning option', () => {
  assert.equal(isCleaningOption({ title: 'Petit déjeuner', autoOptionType: 'breakfast' }), false);
  assert.equal(isCleaningOption({ title: 'Linge de lit', autoOptionType: 'bed_linen' }), false);
});

test('is null/undefined-safe', () => {
  assert.equal(isCleaningOption(null), false);
  assert.equal(isCleaningOption(undefined), false);
  assert.equal(isCleaningOption({}), false);
});

test('normalizeOptionName strips accents and lowercases', () => {
  assert.equal(normalizeOptionName('Ménage'), 'menage');
  assert.equal(normalizeOptionName(null), '');
});
