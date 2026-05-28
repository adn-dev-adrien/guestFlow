const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const optionsModel = require('../models/optionsModel');

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, priceType TEXT, price REAL,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: optionsModel.buildModel(db) };
}

test('create links properties; list/get return propertyIds + normalized tiers', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'ménage', priceType: 'per_stay', price: 50, propertyIds: [1, 2] });
  const got = model.get(id);
  assert.equal(got.title, 'Ménage'); // sentenceCase
  assert.deepEqual(got.propertyIds.sort(), [1, 2]);

  const list = model.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].propertyIds.sort(), [1, 2]);
  assert.equal(model.get(999), null);
});

test('update replaces the property links', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Opt', priceType: 'per_stay', price: 10, propertyIds: [1, 2, 3] });
  model.update(id, { title: 'Opt', priceType: 'per_stay', price: 10, propertyIds: [5] });
  assert.deepEqual(model.get(id).propertyIds, [5]);
});

test('progressive tiers are normalized (deduped, sorted, sanitized)', () => {
  const { model } = freshModel();
  const { id } = model.create({
    title: 'Prog', priceType: 'per_participant_progressive', price: 0,
    optionProgressiveTiers: [{ participantNumber: 2, unitPrice: 20 }, { participantNumber: 1, unitPrice: 30 }, { participantNumber: 2, unitPrice: 25 }],
  });
  const tiers = model.get(id).optionProgressiveTiers;
  assert.deepEqual(tiers, [{ participantNumber: 1, unitPrice: 30 }, { participantNumber: 2, unitPrice: 25 }]);
});

test('remove deletes the option and its links', () => {
  const { db, model } = freshModel();
  const { id } = model.create({ title: 'X', priceType: 'per_stay', price: 5, propertyIds: [1] });
  model.remove(id);
  assert.equal(model.get(id), null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM property_options WHERE optionId = ?').get(id).c, 0);
});
