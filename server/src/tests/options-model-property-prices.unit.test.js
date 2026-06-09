const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/optionsModel');

// specs/per-property-option-prices.md — an option carries a base price, and an optional per-property
// override (property_option_prices). The model must persist overrides, expose them as a
// `propertyPrices` map, and resolve the EFFECTIVE price in listForProperty (override wins, base
// fallback; blank = inherit = no row; explicit 0 = free). Global options can carry overrides too.

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, description TEXT,
      priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]',
      autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed',
      autoFullNightThreshold TEXT,
      countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0,
      linenIncludesSingle INTEGER DEFAULT 1, linenIncludesDouble INTEGER DEFAULT 1, linenIncludesBaby INTEGER DEFAULT 1,
      towelLargePerPerson INTEGER DEFAULT 1, towelMediumPerPerson INTEGER DEFAULT 0, towelSmallPerPerson INTEGER DEFAULT 1
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  `);
  return buildModel(db);
}

test('create persists per-property overrides; get exposes them as a propertyPrices map', () => {
  const model = freshDb();
  const { id } = model.create({
    title: 'Ménage', priceType: 'per_stay', price: 40,
    propertyIds: [10, 20],
    // override on 10 only; 20 left blank (inherit); a blank string is ignored.
    propertyPrices: { 10: 60, 20: '' },
  });
  const opt = model.get(id);
  assert.deepEqual(opt.propertyPrices, { 10: 60 }, 'only the explicit override is stored');
});

test('listForProperty returns the EFFECTIVE price: override wins, base is the fallback', () => {
  const model = freshDb();
  const { id } = model.create({ title: 'Ménage', priceType: 'per_stay', price: 40, propertyIds: [10, 20], propertyPrices: { 10: 60 } });

  const onTen = model.listForProperty(10).find((o) => o.id === id);
  const onTwenty = model.listForProperty(20).find((o) => o.id === id);
  assert.equal(onTen.price, 60, 'property 10 uses its override');
  assert.equal(onTwenty.price, 40, 'property 20 inherits the base price');
});

test('a GLOBAL option (no property_options) can carry a per-property override', () => {
  const model = freshDb();
  // No propertyIds → global. Override only on property 10.
  const { id } = model.create({ title: 'Petit déjeuner', priceType: 'per_person', price: 9, propertyIds: [], propertyPrices: { 10: 12 } });

  assert.equal(model.listForProperty(10).find((o) => o.id === id).price, 12, 'global option overridden on 10');
  assert.equal(model.listForProperty(99).find((o) => o.id === id).price, 9, 'other property inherits base');
});

test('explicit 0 is a real free price; absence inherits the base', () => {
  const model = freshDb();
  const { id } = model.create({ title: 'Spa', priceType: 'per_stay', price: 80, propertyIds: [10, 20], propertyPrices: { 10: 0 } });
  assert.equal(model.listForProperty(10).find((o) => o.id === id).price, 0, 'explicit 0 € for property 10');
  assert.equal(model.listForProperty(20).find((o) => o.id === id).price, 80, 'property 20 inherits base');
});

test('update REPLACES the override set (delete-then-insert)', () => {
  const model = freshDb();
  const { id } = model.create({ title: 'Ménage', priceType: 'per_stay', price: 40, propertyIds: [10, 20], propertyPrices: { 10: 60, 20: 50 } });
  // New save keeps only property 20's override (e.g. 10 was blanked out).
  model.update(id, { title: 'Ménage', priceType: 'per_stay', price: 40, propertyIds: [10, 20], propertyPrices: { 20: 55 } });
  assert.deepEqual(model.get(id).propertyPrices, { 20: 55 });
  assert.equal(model.listForProperty(10).find((o) => o.id === id).price, 40, 'property 10 back to base');
  assert.equal(model.listForProperty(20).find((o) => o.id === id).price, 55);
});

test('update WITHOUT propertyPrices leaves existing overrides untouched (back-compat)', () => {
  const model = freshDb();
  const { id } = model.create({ title: 'Ménage', priceType: 'per_stay', price: 40, propertyIds: [10], propertyPrices: { 10: 60 } });
  model.update(id, { title: 'Ménage MAJ', priceType: 'per_stay', price: 45, propertyIds: [10] }); // no propertyPrices key
  assert.deepEqual(model.get(id).propertyPrices, { 10: 60 }, 'override preserved when the field is omitted');
});
