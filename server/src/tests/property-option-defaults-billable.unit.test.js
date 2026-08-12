const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyOptionDefaultsModel = require('../models/propertyOptionDefaultsModel');

// A property default is a "auto-add this on every NEW reservation" instruction. Two families can
// never actually be carried by a reservation, and listing them puts a phantom line on the fiche —
// displayed, priced at 0, then silently dropped at save:
//   - ARCHIVED options (withdrawn from the catalogue);
//   - INTERNAL linen options (`displayToClient = 0`), which `reservationsModel.insertOptions`
//     skips by construction (specs/laundry-bath-mat.md §3 rule 11).
// The laundry counters read `property_option_defaults` directly in SQL, so they are unaffected.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, archivedAt TEXT, displayToClient INTEGER DEFAULT 1,
      countsAsBathMat INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0,
      PRIMARY KEY (propertyId, optionId));
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare("INSERT INTO options (id, title) VALUES (1, 'Ménage')").run();
  db.prepare("INSERT INTO options (id, title, archivedAt) VALUES (2, 'Ménage', '2026-06-15 19:48:47')").run();
  db.prepare("INSERT INTO options (id, title, displayToClient, countsAsBathMat) VALUES (3, 'Tapis de bain', 0, 1)").run();
  db.prepare("INSERT INTO options (id, title) VALUES (4, 'Linge de lit')").run();
  for (const id of [1, 2, 3, 4]) {
    db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (2, ?, 1)').run(id);
  }
  return db;
}

test('listForProperty drops archived and internal options, keeps the billable ones', () => {
  const db = createDb();
  const model = propertyOptionDefaultsModel.buildModel(db);
  const ids = model.listForProperty(2).map((d) => d.optionId).sort();
  assert.deepEqual(ids, [1, 4], 'only the active, client-visible defaults');
  db.close();
});

test('the excluded rows stay in the table — the laundry counters read it directly', () => {
  const db = createDb();
  const model = propertyOptionDefaultsModel.buildModel(db);
  model.listForProperty(2);
  const bathMat = db.prepare('SELECT offered FROM property_option_defaults WHERE propertyId = 2 AND optionId = 3').get();
  assert.equal(bathMat.offered, 1, 'the « Tapis de bain » default must survive for the laundry card');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM property_option_defaults WHERE propertyId = 2').get().c, 4);
  db.close();
});

test('a duplicate title where one row is archived yields a single default', () => {
  const db = createDb();
  const model = propertyOptionDefaultsModel.buildModel(db);
  const menage = model.listForProperty(2).filter((d) => [1, 2].includes(d.optionId));
  assert.equal(menage.length, 1);
  assert.equal(menage[0].optionId, 1);
  db.close();
});

test('a minimal schema without archivedAt / displayToClient still lists every default', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0,
      PRIMARY KEY (propertyId, optionId));
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare("INSERT INTO options (id, title) VALUES (1, 'Ménage'), (2, 'Linge')").run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (2, 1, 1), (2, 2, 0)').run();
  const model = propertyOptionDefaultsModel.buildModel(db);
  assert.deepEqual(model.listForProperty(2).map((d) => d.optionId), [1, 2]);
  db.close();
});
