// specs/guest-email-texts-made-simple.md rule 30, fixed at the 2026-10-27 spec review: a property
// created or renamed from the property page whose name holds its own article (« La Bergerie »)
// takes that article, confirmed — never « au La Bergerie »; the page offers that one only; and the
// one-shot repair corrects the rows already stored with the wrong article.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const propertiesModelModule = require('../models/propertiesModel');
const ctrl = require('../controllers/propertiesController');
const { repairPropertyOwnArticles } = require('../utils/propertyOwnArticleRepair');

const articleOf = (db, id) => ({ ...db.prepare('SELECT nameArticle, nameArticleConfirmed FROM properties WHERE id = ?').get(id) });

test('a property created from the property page as « La Bergerie » reads « à la », confirmed', async () => {
  const db = freshDb();
  const model = propertiesModelModule.buildModel(db);
  const { id } = await model.create({ name: 'La Bergerie' });
  assert.deepEqual(articleOf(db, id), { nameArticle: 'à la', nameArticleConfirmed: 1 });
  const fournil = await model.create({ name: 'Le Fournil', nameArticle: 'à' });
  assert.deepEqual(articleOf(db, fournil.id), { nameArticle: 'au', nameArticleConfirmed: 1 });
});

test('a name without its own article starts from the guess, unconfirmed', async () => {
  const db = freshDb();
  const model = propertiesModelModule.buildModel(db);
  const { id } = await model.create({ name: 'Oustal' });
  assert.deepEqual(articleOf(db, id), { nameArticle: "à l'", nameArticleConfirmed: 0 });
});

test('a property renamed « Les Pins » takes « aux », confirmed', async () => {
  const db = freshDb();
  const model = propertiesModelModule.buildModel(db);
  const { id } = await model.create({ name: 'Gîte', nameArticle: 'au' });
  await model.update(id, { name: 'Les Pins' });
  assert.deepEqual(articleOf(db, id), { nameArticle: 'aux', nameArticleConfirmed: 1 });
});

test('the property page offers « La Bergerie » its own article only — no « à l\'La Bergerie »', () => {
  let body;
  ctrl.articleLabels({ query: { name: 'La Bergerie' } }, { json: (b) => { body = b; } });
  assert.deepEqual(body.labels, [{ value: 'à la', label: 'à la Bergerie' }]);
});

test('the one-shot repair corrects a stored « au La Bergerie » and leaves other names alone', () => {
  const db = freshDb();
  db.prepare("INSERT INTO properties (id, name, nameArticle, nameArticleConfirmed) VALUES (1, 'La Bergerie', 'au', 0), (2, 'Gîte du lac', 'à', 1), (3, 'L''Oustal', 'au', 0)").run();
  assert.equal(repairPropertyOwnArticles(db), 2);
  assert.deepEqual(articleOf(db, 1), { nameArticle: 'à la', nameArticleConfirmed: 1 });
  assert.deepEqual(articleOf(db, 2), { nameArticle: 'à', nameArticleConfirmed: 1 });
  assert.deepEqual(articleOf(db, 3), { nameArticle: "à l'", nameArticleConfirmed: 1 });
  assert.equal(repairPropertyOwnArticles(db), 0);
});
