/**
 * specs/translation-catalogue.md rules 14-18 — what the guest actually gets.
 *
 * The fallbacks are deliberately asymmetric and that is the whole subject: a missing TITLE falls back
 * to French, because a label cannot be blank; a missing DESCRIPTION is dropped, because a missing
 * line reads better than a French paragraph in an English tunnel. A category is translated as a label
 * only — the grouping key stays French, or the drawer would group differently in each language.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { forLang } = require('../utils/translationResolver');
const { toPublicOption, toPublicResource } = require('../utils/publicProjections');
const { optionKey, resourceKey, categoryKey } = require('../utils/translationCollector');

const CATALOGUE = new Map([
  [optionKey(21, 'title'), 'Apple juice 1L'],
  [optionKey(21, 'description'), '3 apples — Pressoir du Pilat'],
  [categoryKey('Boissons'), 'Drinks'],
  [resourceKey(2), 'Nordic bath'],
]);
const model = { valuesFor: (lang) => (lang === 'en' ? CATALOGUE : new Map()) };

const OPTION = { id: 21, title: 'Jus de pomme 1L', description: '3 pommes — Pressoir du Pilat', category: 'Boissons', priceType: 'per_stay', price: 5 };
const UNTRANSLATED = { id: 99, title: 'Champagne', description: 'Bouteille standard', category: 'Boissons', priceType: 'per_stay', price: 40 };

test('a translated title is served; an untranslated one falls back to French (rule 14)', () => {
  const en = forLang('en', model);
  assert.equal(toPublicOption(OPTION, 'en', en).title, 'Apple juice 1L');
  assert.equal(toPublicOption(UNTRANSLATED, 'en', en).title, 'Champagne');
  assert.notEqual(toPublicOption(UNTRANSLATED, 'en', en).title, '', 'never an empty label, never a key');
});

test('a translated description is served; an untranslated one is OMITTED (rule 15)', () => {
  const en = forLang('en', model);
  assert.equal(toPublicOption(OPTION, 'en', en).description, '3 apples — Pressoir du Pilat');
  assert.equal(toPublicOption(UNTRANSLATED, 'en', en).description, null,
    'a French paragraph must never appear in an English tunnel');
});

test('French keeps its own text, translated or not (rule 18)', () => {
  const fr = forLang('fr', model);
  assert.equal(toPublicOption(OPTION, 'fr', fr).title, 'Jus de pomme 1L');
  assert.equal(toPublicOption(OPTION, 'fr', fr).description, '3 pommes — Pressoir du Pilat');
  assert.equal(fr.category('Boissons'), 'Boissons');
});

test('a language with nothing in the catalogue falls back without erroring (rules 17, 18)', () => {
  const de = forLang('de', model);
  assert.equal(de.optionTitle(21, 'Jus de pomme 1L'), 'Jus de pomme 1L');
  assert.equal(de.optionDescription(21, '3 pommes'), null);
  assert.equal(de.category('Boissons'), 'Boissons');
  assert.doesNotThrow(() => toPublicOption(OPTION, 'de', de));
});

test('a category is translated as a LABEL — the grouping key stays French (rule 16)', () => {
  const en = forLang('en', model);
  assert.equal(en.category('Boissons'), 'Drinks');
  // The projection itself must not translate it: grouping runs on what it emits.
  assert.equal(toPublicOption(OPTION, 'en', en).category, 'Boissons',
    'translating here would make the drawer group differently in each language');
});

test('a resource name is resolved like a title (rule 14)', () => {
  const en = forLang('en', model);
  assert.equal(toPublicResource({ id: 2, name: 'Bain nordique', priceType: 'per_hour', price: 30 }, 'en', en).name, 'Nordic bath');
  assert.equal(toPublicResource({ id: 7, name: 'Vélo', priceType: 'per_hour', price: 5 }, 'en', en).name, 'Vélo');
});

test('`titleEn` still means « the English title », whatever language was asked for', () => {
  assert.equal(toPublicOption(OPTION, 'fr', forLang('fr', model)).titleEn, 'Apple juice 1L');
  assert.equal(toPublicOption(UNTRANSLATED, 'fr', forLang('fr', model)).titleEn, null);
});

test('without a resolver the projection behaves exactly as it did before the catalogue', () => {
  const legacy = { ...OPTION, titleEn: 'Apple juice 1L' };
  assert.equal(toPublicOption(legacy, 'en').title, 'Apple juice 1L');
  assert.equal(toPublicOption(legacy, 'en').description, null);
  assert.equal(toPublicOption(legacy, 'fr').title, 'Jus de pomme 1L');
});

test('the array Array.map hands as a third argument is not mistaken for a resolver', () => {
  // `rows.map(toPublicOption)` passes (row, index, array). The array is truthy; calling it would throw.
  const rows = [OPTION, UNTRANSLATED];
  assert.doesNotThrow(() => rows.map(toPublicOption));
  assert.equal(rows.map(toPublicOption)[0].title, 'Jus de pomme 1L');
});
