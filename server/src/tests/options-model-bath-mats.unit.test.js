const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/optionsModel');

// specs/laundry-bath-mat.md §4 — the "Tapis de bain" option carries a per-property quantity
// (property_option_bath_mats), persisted through the option save payload exactly like
// per-property prices. Mirror of options-model-property-prices.unit.test.js.

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
      towelLargePerPerson INTEGER DEFAULT 1, towelMediumPerPerson INTEGER DEFAULT 0, towelSmallPerPerson INTEGER DEFAULT 1,
      displayToClient INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_bath_mats (propertyId INTEGER, optionId INTEGER, quantity INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  `);
  return buildModel(db);
}

test('create persists per-property bath-mat quantities; get exposes them as a propertyBathMats map', () => {
  const model = freshDb();
  const { id } = model.create({
    title: 'Tapis de bain', priceType: 'per_stay', price: 0,
    propertyIds: [10, 20],
    // quantity on 10 only; 20 left blank (none); 0 is treated as "no bath mat" → no row.
    propertyBathMats: { 10: 2, 20: '' },
  });
  assert.deepEqual(model.get(id).propertyBathMats, { 10: 2 }, 'only the explicit quantity is stored');
});

test('zero quantity stores no row (absence = 0)', () => {
  const model = freshDb();
  const { id } = model.create({
    title: 'Tapis de bain', priceType: 'per_stay', price: 0,
    propertyIds: [10], propertyBathMats: { 10: 0 },
  });
  assert.deepEqual(model.get(id).propertyBathMats, {});
});

test('update REPLACES the quantity set (delete-then-insert)', () => {
  const model = freshDb();
  const { id } = model.create({
    title: 'Tapis de bain', priceType: 'per_stay', price: 0,
    propertyIds: [10, 20], propertyBathMats: { 10: 2, 20: 3 },
  });
  model.update(id, {
    title: 'Tapis de bain', priceType: 'per_stay', price: 0,
    propertyIds: [10, 20], propertyBathMats: { 20: 5 },
  });
  assert.deepEqual(model.get(id).propertyBathMats, { 20: 5 });
});

test('update WITHOUT propertyBathMats leaves existing quantities untouched (back-compat)', () => {
  const model = freshDb();
  const { id } = model.create({
    title: 'Tapis de bain', priceType: 'per_stay', price: 0,
    propertyIds: [10], propertyBathMats: { 10: 2 },
  });
  model.update(id, { title: 'Tapis de bain MAJ', priceType: 'per_stay', price: 0, propertyIds: [10] });
  assert.deepEqual(model.get(id).propertyBathMats, { 10: 2 });
});

test('list exposes propertyBathMats per option', () => {
  const model = freshDb();
  model.create({ title: 'Tapis de bain', priceType: 'per_stay', price: 0, propertyIds: [10], propertyBathMats: { 10: 4 } });
  const opt = model.list().find((o) => o.title === 'Tapis de bain');
  assert.deepEqual(opt.propertyBathMats, { 10: 4 });
});

// specs/laundry-bath-mat.md §3 rule 11 — generic client-visibility flag round-trips.
test('displayToClient round-trips (default 1; explicit 0 persisted)', () => {
  const model = freshDb();
  const visible = model.create({ title: 'Ménage', priceType: 'per_stay', price: 40, displayToClient: true });
  assert.equal(Number(model.get(visible.id).displayToClient), 1);
  const internal = model.create({ title: 'Tapis de bain', priceType: 'per_stay', price: 0, displayToClient: false });
  assert.equal(Number(model.get(internal.id).displayToClient), 0);
  // Flip it back on via update.
  model.update(internal.id, { title: 'Tapis de bain', priceType: 'per_stay', price: 0, displayToClient: true });
  assert.equal(Number(model.get(internal.id).displayToClient), 1);
});
