// specs/pricing-components.md §3 rule 48 — the ports prepare each SQL statement once per database handle, on first use:
// a quote reads the same few statements for every article, and preparing them per call cost more than the reading.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const settingsProvider = require('../models/ports/settingsProvider');
const catalogueProvider = require('../models/ports/catalogueProvider');

function counted() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, maxGuests INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, price REAL);
    CREATE TABLE property_options (optionId INTEGER, propertyId INTEGER);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, price REAL);
    CREATE TABLE property_option_prices (optionId INTEGER, propertyId INTEGER, price REAL, freeUnits REAL);
    CREATE TABLE property_resource_prices (resourceId INTEGER, propertyId INTEGER, price REAL, freeMinutes REAL);
    CREATE TABLE resource_properties (resourceId INTEGER, propertyId INTEGER);
    INSERT INTO properties VALUES (1, 4);
    INSERT INTO options VALUES (1, 'A', 10), (2, 'B', 20);
    INSERT INTO property_options VALUES (1, 1), (2, 1);
    INSERT INTO resources VALUES (1, 'R', 5);
  `);
  const prepared = [];
  const original = db.prepare.bind(db);
  db.prepare = (sql) => { prepared.push(sql); return original(sql); };
  return { db, prepared };
}

test('rule 48 — the catalogue and the settings provider prepare a statement once per handle, however many calls', () => {
  const { db, prepared } = counted();
  const first = catalogueProvider.getApplicableOptions(db, 1);
  const afterFirst = prepared.length;
  for (let i = 0; i < 20; i += 1) catalogueProvider.getApplicableOptions(db, 1);
  catalogueProvider.getApplicableResources(db, 1);
  const afterResources = prepared.length;
  for (let i = 0; i < 20; i += 1) catalogueProvider.getApplicableResources(db, 1);
  assert.equal(prepared.length, afterResources, 'no statement is prepared again');
  assert.ok(afterFirst > 0 && afterResources >= afterFirst);
  assert.equal(new Set(prepared).size, prepared.length, 'each statement text is prepared once');
  assert.deepEqual(catalogueProvider.getApplicableOptions(db, 1).map((o) => [o.id, o.price, o.freeUnits]), first.map((o) => [o.id, o.price, o.freeUnits]));
});

test('rule 48 — the statements belong to their handle: a second database prepares its own', () => {
  const one = counted();
  const two = counted();
  catalogueProvider.getApplicableOptions(one.db, 1);
  catalogueProvider.getApplicableOptions(two.db, 1);
  assert.equal(two.prepared.length, one.prepared.length);
});

test('rule 48 — a statement the schema cannot prepare is not kept: the layer says nothing, then answers once the table exists', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE options (id INTEGER PRIMARY KEY, price REAL); INSERT INTO options VALUES (1, 7);');
  const provider = settingsProvider.create(db);
  const scope = { propertyId: 1, articleRef: { kind: 'option', id: 1 } };
  assert.equal(provider.for('articles', scope).price, 7);
  db.exec('CREATE TABLE property_option_prices (optionId INTEGER, propertyId INTEGER, price REAL, freeUnits REAL); INSERT INTO property_option_prices VALUES (1, 1, 3, 2);');
  db.exec('CREATE TABLE properties (id INTEGER PRIMARY KEY, maxGuests INTEGER); INSERT INTO properties VALUES (1, 5);');
  const after = provider.for('articles', scope);
  assert.deepEqual([after.price, after.freeUnits, after.maxGuests], [3, 2, 5]);
});
