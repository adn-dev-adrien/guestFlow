// titleEn / descriptionEn on options + nameEn on resources — persistence on create/update.
// See specs/devis-english-language.md §3 rules 6, 7.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const optionsModel = require('../models/optionsModel');
const resourcesModel = require('../models/resourcesModel');

function freshOptionsDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, description TEXT, priceType TEXT, price REAL,
      optionProgressiveTiers TEXT, autoOptionType TEXT, autoEnabled INTEGER, autoPricingMode TEXT,
      autoFullNightThreshold TEXT,
      countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0,
      linenIncludesSingle INTEGER DEFAULT 1, linenIncludesDouble INTEGER DEFAULT 1, linenIncludesBaby INTEGER DEFAULT 1,
      towelLargePerPerson INTEGER DEFAULT 1, towelMediumPerPerson INTEGER DEFAULT 0, towelSmallPerPerson INTEGER DEFAULT 1,
      titleEn TEXT NOT NULL DEFAULT '', descriptionEn TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER);
  `);
  return { db, model: optionsModel.buildModel(db) };
}

function freshResourcesDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, nameEn TEXT NOT NULL DEFAULT '',
      quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay',
      note TEXT DEFAULT '', isComplex INTEGER DEFAULT 0, slotDuration INTEGER DEFAULT 60,
      minimumUsageMinutes INTEGER DEFAULT 0, openTime TEXT DEFAULT '08:00', closeTime TEXT DEFAULT '22:00',
      openDays TEXT DEFAULT '[0,1,2,3,4,5,6]', turnoverMinutes INTEGER DEFAULT 0,
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE resource_properties (resourceId INTEGER, propertyId INTEGER);
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER);
  `);
  return { db, model: resourcesModel.create(db) };
}

// ---- options ----

test('optionsModel.create persists titleEn + descriptionEn (trimmed)', () => {
  const { db, model } = freshOptionsDb();
  const { id } = model.create({ title: 'Linge de lit', titleEn: '  Bed linen  ', descriptionEn: '  Sheets and pillowcases  ' });
  const row = db.prepare('SELECT title, titleEn, descriptionEn FROM options WHERE id = ?').get(id);
  assert.equal(row.title, 'Linge de lit');
  assert.equal(row.titleEn, 'Bed linen');
  assert.equal(row.descriptionEn, 'Sheets and pillowcases');
});

test('optionsModel.create handles missing EN fields → stored as empty string (no NULL)', () => {
  const { db, model } = freshOptionsDb();
  const { id } = model.create({ title: 'Sauna' });
  const row = db.prepare('SELECT titleEn, descriptionEn FROM options WHERE id = ?').get(id);
  assert.equal(row.titleEn, '');
  assert.equal(row.descriptionEn, '');
});

test('optionsModel.create does NOT apply sentenceCase to titleEn — operator owns the EN casing', () => {
  const { db, model } = freshOptionsDb();
  const { id } = model.create({ title: 'option test', titleEn: 'CAPITAL CASE' });
  const row = db.prepare('SELECT title, titleEn FROM options WHERE id = ?').get(id);
  assert.equal(row.title, 'Option test', 'FR title sentence-cased');
  assert.equal(row.titleEn, 'CAPITAL CASE', 'EN title preserved as-is');
});

test('optionsModel.update persists new titleEn + descriptionEn', () => {
  const { db, model } = freshOptionsDb();
  const { id } = model.create({ title: 'Sauna', titleEn: 'Sauna' });
  model.update(id, { title: 'Sauna', titleEn: 'Steam sauna', descriptionEn: 'Private session' });
  const row = db.prepare('SELECT titleEn, descriptionEn FROM options WHERE id = ?').get(id);
  assert.equal(row.titleEn, 'Steam sauna');
  assert.equal(row.descriptionEn, 'Private session');
});

test('optionsModel.update clears EN fields when payload provides empty strings', () => {
  const { db, model } = freshOptionsDb();
  const { id } = model.create({ title: 'Sauna', titleEn: 'Sauna', descriptionEn: 'desc' });
  model.update(id, { title: 'Sauna', titleEn: '', descriptionEn: '' });
  const row = db.prepare('SELECT titleEn, descriptionEn FROM options WHERE id = ?').get(id);
  assert.equal(row.titleEn, '');
  assert.equal(row.descriptionEn, '');
});

// ---- resources ----

test('resourcesModel.insert persists nameEn (trimmed)', () => {
  const { db, model } = freshResourcesDb();
  const id = model.insert({ name: 'Lit bébé', nameEn: '  Baby bed  ', quantity: 1, price: 0 });
  const row = db.prepare('SELECT name, nameEn FROM resources WHERE id = ?').get(id);
  assert.equal(row.name, 'Lit bébé');
  assert.equal(row.nameEn, 'Baby bed');
});

test('resourcesModel.insert handles missing nameEn → empty string', () => {
  const { db, model } = freshResourcesDb();
  const id = model.insert({ name: 'Spa', quantity: 1, price: 30 });
  const row = db.prepare('SELECT nameEn FROM resources WHERE id = ?').get(id);
  assert.equal(row.nameEn, '');
});

test('resourcesModel.insert preserves operator-chosen EN casing (no sentenceCase)', () => {
  const { db, model } = freshResourcesDb();
  const id = model.insert({ name: 'wifi access', nameEn: 'WiFi access' });
  const row = db.prepare('SELECT name, nameEn FROM resources WHERE id = ?').get(id);
  assert.equal(row.name, 'Wifi access', 'FR name sentence-cased');
  assert.equal(row.nameEn, 'WiFi access', 'EN name preserved');
});

test('resourcesModel.update persists nameEn', () => {
  const { db, model } = freshResourcesDb();
  const id = model.insert({ name: 'Spa', nameEn: 'Spa' });
  model.update(id, { name: 'Spa', nameEn: 'Spa session' });
  const row = db.prepare('SELECT nameEn FROM resources WHERE id = ?').get(id);
  assert.equal(row.nameEn, 'Spa session');
});

test('resourcesModel.update clears nameEn on empty payload', () => {
  const { db, model } = freshResourcesDb();
  const id = model.insert({ name: 'Spa', nameEn: 'Spa session' });
  model.update(id, { name: 'Spa', nameEn: '' });
  const row = db.prepare('SELECT nameEn FROM resources WHERE id = ?').get(id);
  assert.equal(row.nameEn, '');
});
