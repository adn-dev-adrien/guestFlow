const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/optionsModel');

// specs/option-property-scope.md §3.3 — the public per-property options endpoint returns ONLY the
// options EXPLICITLY linked to that property. The legacy « no link = global (everywhere) » rule is
// removed: an option with no property_options row is available NOWHERE. « Tous les logements » is now
// encoded as a link to every property.

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      priceType TEXT,
      price REAL DEFAULT 0,
      optionProgressiveTiers TEXT,
      autoOptionType TEXT
    );
    CREATE TABLE property_options (
      propertyId INTEGER NOT NULL,
      optionId INTEGER NOT NULL,
      PRIMARY KEY (propertyId, optionId)
    );
  `);
  // [1] linked to property 10 ; [2] « Tous » (linked to 10 AND 20) ; [3] linked to 20 ; [4] « Aucun » (no link).
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 40)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (2, 'Petit déjeuner', 'per_person_per_night', 9)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (3, 'Spa privatif', 'per_stay', 80)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (4, 'Linge de toilette', 'per_person', 5)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (10, 1)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (10, 2)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (20, 2)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (20, 3)').run();
  return db;
}

test('listForProperty returns ONLY the options linked to that property, sorted by title', () => {
  const model = buildModel(freshDb());
  // property 10 → its own (Ménage) + the « Tous » option (Petit déjeuner); NOT Spa (prop 20 only).
  assert.deepEqual(model.listForProperty(10).map((o) => o.title), ['Ménage', 'Petit déjeuner']);
});

test('a different property gets ITS links (no cross-property leak)', () => {
  const model = buildModel(freshDb());
  assert.deepEqual(model.listForProperty(20).map((o) => o.title).sort(), ['Petit déjeuner', 'Spa privatif']);
  assert.ok(!model.listForProperty(20).some((o) => o.title === 'Ménage'), "property 10's option must not leak");
});

test('an unlinked option (« Aucun ») is available for NO property', () => {
  const model = buildModel(freshDb());
  for (const pid of [10, 20, 999]) {
    assert.ok(!model.listForProperty(pid).some((o) => o.title === 'Linge de toilette'), `Linge de toilette must not appear for ${pid}`);
  }
});

test('a property with no links sees no options', () => {
  const model = buildModel(freshDb());
  assert.deepEqual(model.listForProperty(999).map((o) => o.title), []);
});

test('base price is returned as-is for a linked option', () => {
  const model = buildModel(freshDb());
  const breakfast = model.listForProperty(10).find((o) => o.title === 'Petit déjeuner');
  assert.equal(breakfast.price, 9);
});
