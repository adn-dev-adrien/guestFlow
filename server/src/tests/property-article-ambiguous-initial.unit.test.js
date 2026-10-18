// specs/guest-email-texts-made-simple.md rule 30 (2026-10-18) — « y » and « h » are no vowels for the
// article: « la Yourte », « le Hameau » (h aspiré), « l'Hôtel »; such a name is offered the five
// articles. The property page reads the articles as the emails write them from the server.

const test = require('node:test');
const assert = require('node:assert/strict');

const propertyArticle = require('../utils/propertyArticle');
const ctrl = require('../controllers/propertiesController');

test('rule 30: a name starting with « y » or « h » is not guessed « à l\' » and is offered every article', () => {
  for (const name of ['Yourte du Lac', 'Hutte', 'Hameau', 'Hôtel du Pont']) {
    assert.deepEqual(propertyArticle.derive(name), { article: 'au', certain: false }, name);
    assert.deepEqual(propertyArticle.choices(name).map((c) => c.value), [...propertyArticle.ARTICLES], name);
  }
  assert.ok(propertyArticle.choices('Yourte du Lac').some((c) => c.label === 'à la Yourte du Lac'));
});

test('rule 30: a real vowel keeps its guess and its three choices; a consonant its four', () => {
  assert.deepEqual(propertyArticle.derive('Estiva'), { article: "à l'", certain: false });
  assert.deepEqual(propertyArticle.choices('Estiva').map((c) => c.value), ["à l'", 'aux', 'à']);
  assert.deepEqual(propertyArticle.choices('Gite').map((c) => c.value), ['au', 'à la', 'aux', 'à']);
});

test('rule 30: the property page labels are the contracted forms the emails send', () => {
  const labels = propertyArticle.labels('Le Fournil');
  assert.equal(labels.find((l) => l.value === 'au').label, 'au Fournil');
  assert.equal(labels.length, 5);
  assert.deepEqual(propertyArticle.labels('').map((l) => l.label), [...propertyArticle.ARTICLES]);
  let body;
  ctrl.articleLabels({ query: { name: 'Les Pins' } }, { json: (b) => { body = b; } });
  assert.equal(body.labels.find((l) => l.value === 'aux').label, 'aux Pins');
});
