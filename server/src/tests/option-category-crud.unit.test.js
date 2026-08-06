// specs/option-categories.md §3 rules 1, 3, 6 — the category round-trip through optionsModel.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const optionsModel = require('../models/optionsModel');

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, priceType TEXT, price REAL,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0,
    countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
    linenIncludesSingle INTEGER NOT NULL DEFAULT 1,
    linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
    linenIncludesBaby INTEGER NOT NULL DEFAULT 1,
    towelLargePerPerson INTEGER NOT NULL DEFAULT 1,
    towelMediumPerPerson INTEGER NOT NULL DEFAULT 0,
    towelSmallPerPerson INTEGER NOT NULL DEFAULT 1,
    archivedAt TEXT,
    category TEXT NOT NULL DEFAULT '',
    seedKey TEXT NOT NULL DEFAULT '',
    alwaysVisible INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: optionsModel.buildModel(db) };
}

test('create stores the category and get/list return it', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Champagne 75cl', priceType: 'per_stay', price: 40, category: 'Boissons' });
  assert.equal(model.get(id).category, 'Boissons');
  assert.equal(model.list()[0].category, 'Boissons');
});

test('an omitted category defaults to ungrouped', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Ménage', priceType: 'per_stay', price: 80 });
  assert.equal(model.get(id).category, '');
});

test('a whitespace-only category is stored as ungrouped', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Ménage', priceType: 'per_stay', price: 80, category: '   ' });
  assert.equal(model.get(id).category, '');
});

test('padded labels are trimmed so they land in the same group', () => {
  const { model } = freshModel();
  const a = model.create({ title: 'Mad Max', priceType: 'per_stay', price: 7.5, category: ' Boissons ' });
  const b = model.create({ title: 'Biscanna', priceType: 'per_stay', price: 7.5, category: 'Boissons' });
  assert.equal(model.get(a.id).category, 'Boissons');
  assert.equal(model.get(b.id).category, 'Boissons');
});

test('update changes the category, including clearing it back to ungrouped', () => {
  const { model } = freshModel();
  const { id } = model.create({ title: 'Balade nocturne', priceType: 'per_stay', price: 65, category: 'Animations' });
  model.update(id, { title: 'Balade nocturne', priceType: 'per_stay', price: 65, category: 'Restauration' });
  assert.equal(model.get(id).category, 'Restauration');
  model.update(id, { title: 'Balade nocturne', priceType: 'per_stay', price: 65, category: '' });
  assert.equal(model.get(id).category, '');
});

test('an update that omits the category PRESERVES it', () => {
  // Guards against the class of bug that bit autoOptionType in 2026-07: a caller that predates the
  // field (SAS upsell path, older client) must not silently un-group an option.
  const { model } = freshModel();
  const { id } = model.create({ title: 'Champagne 75cl', priceType: 'per_stay', price: 40, category: 'Boissons' });
  model.update(id, { title: 'Champagne 75cl', priceType: 'per_stay', price: 42 });
  assert.equal(model.get(id).category, 'Boissons');
  assert.equal(Number(model.get(id).price), 42);
});

test('list orders ungrouped options first, then categories alphabetically', () => {
  const { model } = freshModel();
  model.create({ title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' });
  model.create({ title: 'Planche S', priceType: 'per_stay', price: 17, category: 'Restauration' });
  model.create({ title: 'Ménage', priceType: 'per_stay', price: 80 });
  model.create({ title: 'Balade', priceType: 'per_stay', price: 65, category: 'Animations' });
  assert.deepEqual(model.list().map((o) => o.title), ['Ménage', 'Balade', 'Champagne', 'Planche s']);
});

test('listForProperty exposes the category for the public/fiche payloads', () => {
  const { model } = freshModel();
  model.create({ title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons', propertyIds: [1] });
  const rows = model.listForProperty(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'Boissons');
});

test('alwaysVisible round-trips and defaults to off', () => {
  const { model } = freshModel();
  const plain = model.create({ title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' });
  assert.equal(Number(model.get(plain.id).alwaysVisible), 0);

  const pinned = model.create({ title: 'Petit déjeuner', priceType: 'per_person', price: 12, category: 'Restauration', alwaysVisible: true });
  assert.equal(Number(model.get(pinned.id).alwaysVisible), 1);

  model.update(pinned.id, { title: 'Petit déjeuner', priceType: 'per_person', price: 12, alwaysVisible: false });
  assert.equal(Number(model.get(pinned.id).alwaysVisible), 0);
});

test('an update that omits alwaysVisible PRESERVES it', () => {
  // Same guard as `category`: a caller unaware of the field must not silently unpin an option.
  const { model } = freshModel();
  const { id } = model.create({ title: 'Petit déjeuner', priceType: 'per_person', price: 12, category: 'Restauration', alwaysVisible: true });
  model.update(id, { title: 'Petit déjeuner', priceType: 'per_person', price: 14 });
  assert.equal(Number(model.get(id).alwaysVisible), 1);
});
