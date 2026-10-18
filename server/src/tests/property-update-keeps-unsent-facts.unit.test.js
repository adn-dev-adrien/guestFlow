// specs/guest-email-texts-made-simple.md rules 28 and 30 (2026-10-18) — saving the property page
// never resets what it does not send: an empty deposit keeps the stored amount (no 500 € back), and an
// article the form leaves out is neither changed nor confirmed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const propertiesModelModule = require('../models/propertiesModel');
const { validatePropertyInput } = require('../utils/propertyValidation');

function setup() {
  const db = freshDb();
  applyProductisationSchema(db);
  return { db, model: propertiesModelModule.buildModel(db) };
}

const row = (db, id) => db.prepare('SELECT defaultCautionAmount, nameArticle, nameArticleConfirmed, pendingFacts, cleaningIncluded FROM properties WHERE id = ?').get(id);

test('rule 28: a property page saved without the deposit keeps it — pending stays 0 and pending', async () => {
  const { db, model } = setup();
  const { id } = await model.create({ name: 'Le Fournil', defaultCautionAmount: 0 });
  db.prepare("UPDATE properties SET pendingFacts = 'caution,cleaning,towels,linen' WHERE id = ?").run(id);
  // The client's FormData: everything as strings, the pending deposit left out, the cleaning answered.
  await model.update(id, { name: 'Le Fournil', maxGuests: '2', cleaningIncluded: '1', nameArticle: 'au' });
  const p = row(db, id);
  assert.equal(p.defaultCautionAmount, 0);
  assert.equal(p.pendingFacts, 'caution,towels,linen');
  assert.equal(p.cleaningIncluded, 1);
});

test('rule 28: an emptied deposit on a configured property keeps the stored amount', async () => {
  const { db, model } = setup();
  const { id } = await model.create({ name: 'Aventura lodge', defaultCautionAmount: 400 });
  await model.update(id, { name: 'Aventura lodge', defaultCautionAmount: '' });
  assert.equal(row(db, id).defaultCautionAmount, 400);
  await model.update(id, { name: 'Aventura lodge' });
  assert.equal(row(db, id).defaultCautionAmount, 400);
  await model.update(id, { name: 'Aventura lodge', defaultCautionAmount: '0' });
  assert.equal(row(db, id).defaultCautionAmount, 0);
  await model.update(id, { name: 'Aventura lodge', defaultCautionAmount: '350,5' });
  assert.equal(row(db, id).defaultCautionAmount, 350.5);
});

test('rule 28: an empty deposit is not refused by the validation (it means « unchanged »)', () => {
  assert.equal(validatePropertyInput({ defaultCautionAmount: '' }, null).defaultCautionAmount, undefined);
  assert.ok(validatePropertyInput({ defaultCautionAmount: '-1' }, null).defaultCautionAmount);
});

test('rule 30: a save without the article keeps it and leaves it unconfirmed', async () => {
  const { db, model } = setup();
  const { id } = await model.create({ name: 'Cabane des Hérons' });
  db.prepare("UPDATE properties SET nameArticle = 'à la', nameArticleConfirmed = 0 WHERE id = ?").run(id);
  await model.update(id, { name: 'Cabane des Hérons', poolSeasonStart: '06-01', poolSeasonEnd: '09-15' });
  assert.deepEqual([row(db, id).nameArticle, row(db, id).nameArticleConfirmed], ['à la', 0]);
  await model.update(id, { name: 'Cabane des Hérons', nameArticle: '' });
  assert.equal(row(db, id).nameArticleConfirmed, 0);
  await model.update(id, { name: 'Cabane des Hérons', nameArticle: 'à la' });
  assert.deepEqual([row(db, id).nameArticle, row(db, id).nameArticleConfirmed], ['à la', 1]);
});
