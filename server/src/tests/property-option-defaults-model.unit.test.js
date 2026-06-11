const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyOptionDefaultsModel = require('../models/propertyOptionDefaultsModel');

// In-memory schema mirrors the production tables for the affected slice.
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
    CREATE TABLE property_option_defaults (
      propertyId INTEGER NOT NULL,
      optionId   INTEGER NOT NULL,
      offered    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (propertyId, optionId),
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
    );
    CREATE TABLE property_options (
      propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId)
    );
  `);
  db.pragma('foreign_keys = ON');
  // Seed a small, deterministic fixture: two properties + two linen options.
  db.prepare("INSERT INTO properties (id, name) VALUES (10, 'Gite'), (11, 'Tente')").run();
  db.prepare("INSERT INTO options (id, title) VALUES (20, 'Linge de lit'), (21, 'Linge de toilette')").run();
  return db;
}

function freshModel() {
  const db = makeDb();
  return { db, model: propertyOptionDefaultsModel.buildModel(db) };
}

test('set: inserts a default for (propertyId, optionId) with offered flag', () => {
  const { db, model } = freshModel();
  const row = model.set(10, 20, true);
  assert.deepEqual(row, { propertyId: 10, optionId: 20, offered: true });

  const stored = db.prepare('SELECT * FROM property_option_defaults WHERE propertyId = 10 AND optionId = 20').get();
  assert.equal(Number(stored.offered), 1);
});

test('set: also makes the option applicable to the property (a default implies applicability)', () => {
  const { db, model } = freshModel();
  model.set(10, 20, true);
  assert.ok(
    db.prepare('SELECT 1 FROM property_options WHERE propertyId = 10 AND optionId = 20').get(),
    'setting a default upserts the property_options applicability row',
  );
  // Idempotent: re-setting (even flipping offered) never duplicates the applicability row.
  model.set(10, 20, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_options WHERE propertyId = 10 AND optionId = 20').get().n, 1);
});

test('set: idempotent — re-setting the same pair updates `offered` in place', () => {
  const { db, model } = freshModel();
  model.set(10, 20, false);
  model.set(10, 20, true);
  const all = db.prepare('SELECT * FROM property_option_defaults WHERE propertyId = 10').all();
  assert.equal(all.length, 1, 'no duplicate row');
  assert.equal(Number(all[0].offered), 1, 'offered updated to true');
});

test('unset: removes the row and returns 1; second unset returns 0', () => {
  const { model } = freshModel();
  model.set(10, 20, true);
  assert.equal(model.unset(10, 20), 1);
  assert.equal(model.unset(10, 20), 0, 'unsetting a missing row is a no-op');
});

test('listForProperty: returns every default for that property, sorted by optionId', () => {
  const { model } = freshModel();
  model.set(10, 21, true);
  model.set(10, 20, false);
  model.set(11, 20, true); // different property — must be excluded.

  assert.deepEqual(model.listForProperty(10), [
    { optionId: 20, offered: false },
    { optionId: 21, offered: true },
  ]);
});

test('listForOption: returns every property that has this option as default, with names', () => {
  const { model } = freshModel();
  model.set(10, 20, true);
  model.set(11, 20, false);
  model.set(10, 21, true); // different option — must be excluded.

  assert.deepEqual(model.listForOption(20), [
    { propertyId: 10, propertyName: 'Gite', offered: true },
    { propertyId: 11, propertyName: 'Tente', offered: false },
  ]);
});

test('FK ON DELETE CASCADE: deleting a property removes its defaults', () => {
  const { db, model } = freshModel();
  model.set(10, 20, true);
  model.set(10, 21, false);
  model.set(11, 20, true);
  db.prepare('DELETE FROM properties WHERE id = 10').run();
  assert.deepEqual(model.listForProperty(10), []);
  assert.deepEqual(model.listForOption(20), [
    { propertyId: 11, propertyName: 'Tente', offered: true },
  ]);
});

test('FK ON DELETE CASCADE: deleting an option removes its defaults across properties', () => {
  const { db, model } = freshModel();
  model.set(10, 20, true);
  model.set(11, 20, true);
  model.set(10, 21, false);
  db.prepare('DELETE FROM options WHERE id = 20').run();
  assert.deepEqual(model.listForOption(20), []);
  // Other option for property 10 untouched.
  assert.deepEqual(model.listForProperty(10), [{ optionId: 21, offered: false }]);
});

test('listForProperty: empty result for an unknown propertyId, no crash', () => {
  const { model } = freshModel();
  assert.deepEqual(model.listForProperty(999), []);
});

test('set: coerces string ids + boolean-ish offered values defensively', () => {
  const { model } = freshModel();
  const row = model.set('10', '20', 1);
  assert.deepEqual(row, { propertyId: 10, optionId: 20, offered: true });
});
