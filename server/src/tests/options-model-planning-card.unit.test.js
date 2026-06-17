const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const optionsModel = require('../models/optionsModel');

// specs/option-planning-card.md §3.1 + §4.1 — the options model round-trips the planning-card
// config: the toggle, the repeat mode, the default date ('once' only), and the slot list (JSON).

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, priceType TEXT, price REAL,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
    linenIncludesSingle INTEGER NOT NULL DEFAULT 1, linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
    linenIncludesBaby INTEGER NOT NULL DEFAULT 1,
    towelLargePerPerson INTEGER NOT NULL DEFAULT 1, towelMediumPerPerson INTEGER NOT NULL DEFAULT 0,
    towelSmallPerPerson INTEGER NOT NULL DEFAULT 1, archivedAt TEXT,
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT NOT NULL DEFAULT 'once',
    planningCardDate TEXT, planningCardTimes TEXT
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: optionsModel.buildModel(db) };
}

test("'multiple_per_day' card: persists the slot list, planningCardTimes parses back to an array", () => {
  const { model } = freshModel();
  const { id } = model.create({
    title: 'Repas', priceType: 'per_person', price: 5,
    showsPlanningCard: true, cardRepeat: 'multiple_per_day', planningCardTimes: ['08:00', '12:30', '19:30'],
  });
  const got = model.get(id);
  assert.equal(got.showsPlanningCard, 1);
  assert.equal(got.cardRepeat, 'multiple_per_day');
  assert.deepEqual(got.planningCardTimes, ['08:00', '12:30', '19:30']);
  assert.equal(got.planningCardDate, null); // no fixed-date mode anymore
});

test("'once_per_day' card: clamps to a single slot", () => {
  const { model } = freshModel();
  const { id } = model.create({
    title: 'Apéro', priceType: 'per_stay', price: 0,
    showsPlanningCard: true, cardRepeat: 'once_per_day', planningCardTimes: ['18:00', '20:00'],
  });
  const got = model.get(id);
  assert.equal(got.cardRepeat, 'once_per_day');
  assert.equal(got.planningCardDate, null);
  assert.deepEqual(got.planningCardTimes, ['18:00'], 'once_per_day clamps to one slot');
});

test("legacy 'daily' maps to multiple_per_day", () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'L', priceType: 'per_stay', price: 0, showsPlanningCard: true, cardRepeat: 'daily', planningCardTimes: ['10:00', '14:00'] });
  assert.equal(model.get(id).cardRepeat, 'multiple_per_day');
});

test('toggle OFF persists showsPlanningCard = 0; list parses planningCardTimes too', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'X', priceType: 'per_stay', price: 0, showsPlanningCard: false });
  const got = model.get(id);
  assert.equal(got.showsPlanningCard, 0);
  assert.deepEqual(got.planningCardTimes, []);
  assert.deepEqual(model.list()[0].planningCardTimes, []);
});

test('update round-trips the card config', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Y', priceType: 'per_stay', price: 0 });
  model.update(id, { title: 'Y', priceType: 'per_stay', price: 0, showsPlanningCard: true, cardRepeat: 'once_per_day', planningCardTimes: ['09:00'] });
  const got = model.get(id);
  assert.equal(got.showsPlanningCard, 1);
  assert.equal(got.cardRepeat, 'once_per_day');
  assert.deepEqual(got.planningCardTimes, ['09:00']);
});
