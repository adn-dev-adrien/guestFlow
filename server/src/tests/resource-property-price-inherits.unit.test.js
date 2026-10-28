// specs/options-resources-ux.md rule 28 — a resource's property line with no price of its own (a free first
// hour only) is stored as NULL and inherits the base price; the migration that allows it keeps every row.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const resourcesModel = require('../models/resourcesModel');
const { makeResourcePriceNullable, priceIsNotNull } = require('../utils/resourcePriceNullableMigration');

const BASE_DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', note TEXT DEFAULT '',
    isComplex INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 60,
    minimumUsageMinutes INTEGER NOT NULL DEFAULT 0, openTime TEXT NOT NULL DEFAULT '08:00',
    closeTime TEXT NOT NULL DEFAULT '22:00', openDays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    turnoverMinutes INTEGER NOT NULL DEFAULT 0, updatedAt TEXT
  );
  CREATE TABLE resource_properties (resourceId INTEGER NOT NULL, propertyId INTEGER NOT NULL, PRIMARY KEY (resourceId, propertyId));
  CREATE TABLE property_resource_prices (
    propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL NOT NULL DEFAULT 0, freeMinutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );
  CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT, finalPrice REAL, babyBeds INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity INTEGER);
`;

function legacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(BASE_DDL);
  db.exec("INSERT INTO properties (name) VALUES ('Granja'), ('Estiva')");
  db.exec('CREATE INDEX idx_property_resource_prices_resource ON property_resource_prices(resourceId)');
  return db;
}

function freshModel() {
  const db = legacyDb();
  makeResourcePriceNullable(db);
  return { db, model: resourcesModel.create(db) };
}

const bath = (over = {}) => ({
  name: 'Bain', quantity: 1, price: 30, priceType: 'per_hour', propertyIds: [1, 2], ...over,
});

test('rule 28: the migration relaxes NOT NULL and keeps every row and value exactly as stored', () => {
  const db = legacyDb();
  db.exec("INSERT INTO resources (name, price) VALUES ('Bain', 30), ('Vélo', 5)");
  db.exec("INSERT INTO property_resource_prices VALUES (1, 1, 30, 60), (2, 1, 0, 60), (1, 2, 7.5, 0)");
  const before = db.prepare('SELECT * FROM property_resource_prices ORDER BY propertyId, resourceId').all();
  assert.equal(priceIsNotNull(db), true);
  assert.equal(makeResourcePriceNullable(db), 3);
  assert.equal(priceIsNotNull(db), false);
  assert.deepEqual(db.prepare('SELECT * FROM property_resource_prices ORDER BY propertyId, resourceId').all(), before);
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (2, 2, NULL, 60)').run();
});

test('rule 28: the migration keeps the baseline index, so the schema does not change on the next boot', () => {
  const db = legacyDb();
  makeResourcePriceNullable(db);
  const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_property_resource_prices_resource'").get();
  assert.ok(index);
});

test('rule 28: the migration is idempotent and keeps the cascades', () => {
  const db = legacyDb();
  db.exec("INSERT INTO resources (name, price) VALUES ('Bain', 30)");
  db.exec('INSERT INTO property_resource_prices VALUES (1, 1, 30, 60)');
  makeResourcePriceNullable(db);
  assert.equal(makeResourcePriceNullable(db), null);
  db.prepare('DELETE FROM resources WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_resource_prices').get().n, 0);
});

test('rule 28: a blank price with a free hour is stored NULL, and a reload reads it back as no price', () => {
  const { db, model } = freshModel();
  const id = model.insert(bath({ propertyPricing: { 1: { price: null, freeMinutes: 60 }, 2: { price: '', freeMinutes: 0 } } }));
  assert.deepEqual(db.prepare('SELECT propertyId, price, freeMinutes FROM property_resource_prices WHERE resourceId = ?').all(id),
    [{ propertyId: 1, price: null, freeMinutes: 60 }]);
  const stored = model.findById(id);
  assert.deepEqual(stored.propertyPricing, { 1: { price: null, freeMinutes: 60 } });
  assert.deepEqual(stored.propertyPrices, {});
});

test('rule 28: a typed 0 is a price (free there), a blank is not', () => {
  const { db, model } = freshModel();
  const id = model.insert(bath({ propertyPricing: { 1: { price: 0, freeMinutes: 0 }, 2: { price: null, freeMinutes: 60 } } }));
  assert.deepEqual(db.prepare('SELECT propertyId, price FROM property_resource_prices WHERE resourceId = ? ORDER BY propertyId').all(id),
    [{ propertyId: 1, price: 0 }, { propertyId: 2, price: null }]);
  assert.equal(model.list(1)[0].price, 0);
  assert.equal(model.list(2)[0].price, 30);
});

test('rule 28: raising the base price moves the lines that inherit it, not the ones with a price', () => {
  const { model } = freshModel();
  const id = model.insert(bath({ propertyPricing: { 1: { price: null, freeMinutes: 60 }, 2: { price: 40, freeMinutes: 60 } } }));
  const raise = () => model.update(id, bath({ price: 35, propertyPricing: model.findById(id).propertyPricing }));
  raise();
  const [granja] = model.list(1);
  const [estiva] = model.list(2);
  assert.equal(granja.price, 35);
  assert.equal(granja.freeMinutes, 60);
  assert.equal(estiva.price, 40);
});

test('rule 28: a negative or non-numeric stored price is still refused by the model', () => {
  const { db, model } = freshModel();
  const id = model.insert(bath({ propertyPricing: { 1: { price: -4, freeMinutes: 0 }, 2: { price: 'x', freeMinutes: 0 } } }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_resource_prices WHERE resourceId = ?').get(id).n, 0);
});
