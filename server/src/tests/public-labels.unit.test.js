/**
 * specs/site-english-version.md §3 rules 1, 3, 8, 12 — the public label dictionary.
 *
 * The point of these tests is the guarantee the module exists for: an English page must never show
 * a French word, and a missing translation must break loudly here rather than quietly on the site.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  labels,
  errorMessage,
  normalisePublicLang,
  statesLang,
  supportedLanguages,
  FR,
  EN,
} = require('../utils/publicLabels');

/** Walk both maps together and report every key whose shape differs. */
function shapeDiff(a, b, path = '') {
  const problems = [];
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  for (const key of keysA) if (!keysB.includes(key)) problems.push(`${path}${key}: missing in EN`);
  for (const key of keysB) if (!keysA.includes(key)) problems.push(`${path}${key}: missing in FR`);
  for (const key of keysA) {
    if (!keysB.includes(key)) continue;
    const va = a[key];
    const vb = b[key];
    if (typeof va !== typeof vb) {
      problems.push(`${path}${key}: ${typeof va} in FR, ${typeof vb} in EN`);
      continue;
    }
    if (va && vb && typeof va === 'object') problems.push(...shapeDiff(va, vb, `${path}${key}.`));
  }
  return problems;
}

test('FR and EN have exactly the same shape', () => {
  assert.deepEqual(shapeDiff(FR, EN), []);
});

test('every label carries a non-empty string in both languages', () => {
  const empties = [];
  const walk = (map, lang, path = '') => {
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'string' && value.trim() === '') empties.push(`${lang}:${path}${key}`);
      else if (value && typeof value === 'object') walk(value, lang, `${path}${key}.`);
    }
  };
  walk(FR, 'fr');
  walk(EN, 'en');
  assert.deepEqual(empties, []);
});

test('no English label is left in French', () => {
  // A cheap but effective net: these words cannot legitimately appear in the English map.
  const french = /\b(par|pour|nuit|nuits|séjour|personne|personnes|nombre|introuvable|invalides?)\b/i;
  const offenders = [];
  const walk = (map, path = '') => {
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'string' && french.test(value)) offenders.push(`${path}${key} = ${value}`);
      else if (value && typeof value === 'object') walk(value, `${path}${key}.`);
    }
  };
  walk(EN);
  assert.deepEqual(offenders, []);
});

test('every priceType the catalogue can emit has a unit label in both languages', () => {
  const types = [
    'per_person',
    'per_person_per_night',
    'per_night',
    'per_stay',
    'per_participant_progressive',
    'percent_of_stay',
  ];
  for (const type of types) {
    assert.equal(typeof FR.priceUnit[type], 'string', `FR missing ${type}`);
    assert.equal(typeof EN.priceUnit[type], 'string', `EN missing ${type}`);
  }
});

test('labels() fails loud on an unknown language', () => {
  assert.throws(() => labels('de'), /unknown language/);
  assert.throws(() => labels(''), /unknown language/);
  assert.throws(() => labels(null), /unknown language/);
});

test('errorMessage() fails loud on an unknown key rather than leaking the key', () => {
  assert.throws(() => errorMessage('fr', 'nope'), /unknown error key/);
  assert.equal(errorMessage('en', 'datesUnavailable'), 'These dates are no longer available.');
  assert.equal(errorMessage('fr', 'datesUnavailable'), 'Ces dates ne sont plus disponibles.');
});

test('every error message exists in both languages', () => {
  assert.deepEqual(Object.keys(FR.errors).sort(), Object.keys(EN.errors).sort());
});

test('normalisePublicLang accepts what a browser or WordPress actually sends', () => {
  for (const value of ['en', 'EN', 'en-GB', 'en_GB', 'en-us', ' en ']) {
    assert.equal(normalisePublicLang(value), 'en', `expected en for ${JSON.stringify(value)}`);
  }
  for (const value of ['fr', 'FR', 'fr-FR', 'de', 'garbage', '', '   ', null, undefined, 42, {}]) {
    assert.equal(normalisePublicLang(value), 'fr', `expected fr for ${JSON.stringify(value)}`);
  }
});

test('normalisePublicLang never throws — a language token must not cost a booking', () => {
  for (const value of [[], {}, () => {}, Symbol.iterator ? 'ok' : 'ok', NaN, Infinity]) {
    assert.doesNotThrow(() => normalisePublicLang(value));
  }
});

test('statesLang separates "no language stated" from "stated as fr"', () => {
  // Rule 12 hangs on this distinction: only an explicit language may overwrite a stored one.
  assert.equal(statesLang('fr'), true);
  assert.equal(statesLang('en'), true);
  assert.equal(statesLang('de'), true, 'unknown but stated — it resolves to fr AND counts as stated');
  assert.equal(statesLang(''), false);
  assert.equal(statesLang('   '), false);
  assert.equal(statesLang(null), false);
  assert.equal(statesLang(undefined), false);
});

test('supportedLanguages lists exactly the two built maps', () => {
  assert.deepEqual(supportedLanguages().sort(), ['en', 'fr']);
});

test('the portion wordings differ per language and per meal kind', () => {
  assert.equal(FR.portions.breakfast.quantityLabel, 'Nombre de petits déjeuners');
  assert.equal(EN.portions.breakfast.quantityLabel, 'Number of breakfasts');
  assert.equal(EN.portions.meal.quantityLabel, 'Number of covers');
  assert.notEqual(EN.portions.breakfast.unit, EN.portions.meal.unit);
});

test('the French offered-allowance agreement follows the written unit, the English one does not exist', () => {
  assert.equal(FR.offeredAgreement(true), 'offertes');
  assert.equal(FR.offeredAgreement(false), 'offerte');
  assert.equal(EN.offeredAgreement(true), 'included');
  assert.equal(EN.offeredAgreement(false), 'included');
});
