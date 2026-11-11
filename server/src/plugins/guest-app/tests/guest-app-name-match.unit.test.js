// specs/guest-app.md rule 7 — name matching.
const test = require('node:test');
const assert = require('node:assert/strict');

const { nameMatches, normalizeName } = require('../nameMatch');

test('rule 7: accents, case, hyphens and spaces do not count', () => {
  assert.equal(normalizeName('Le Goff-Durand'), 'legoffdurand');
  assert.equal(normalizeName('  Éloïse  D’Àrc '), 'eloisedarc');
  assert.equal(nameMatches('le goff durand', ['Le Goff-Durand']), true);
  assert.equal(nameMatches('LÉGOFFDURAND', ['Le Goff-Durand']), true);
});

test('rule 7: every non-letter is removed, a digit included', () => {
  assert.equal(normalizeName('Martin 2'), 'martin');
});

test('rule 7: a different name does not match, nor does a prefix', () => {
  assert.equal(nameMatches('Durand', ['Le Goff-Durand']), false);
  assert.equal(nameMatches('Le Goff', ['Le Goff-Durand']), false);
});

test('rule 7: any name on file is accepted', () => {
  assert.equal(nameMatches('Martin', ['Durand', 'Martin']), true);
  assert.equal(nameMatches('Petit', ['Durand', 'Martin']), false);
});

test('rule 7: an empty name never matches, on either side', () => {
  assert.equal(nameMatches('', ['']), false);
  assert.equal(nameMatches('---', ['']), false);
  assert.equal(nameMatches('Durand', ['']), false);
  assert.equal(nameMatches('', ['Durand']), false);
  assert.equal(nameMatches(null, []), false);
  assert.equal(nameMatches(undefined, [null]), false);
});
