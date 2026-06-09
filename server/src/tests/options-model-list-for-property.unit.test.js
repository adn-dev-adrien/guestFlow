const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/optionsModel');

// specs/public-api.md — the public per-property options endpoint must return options that are
// EITHER explicitly linked to the property OR global ("Tous les logements" = no property_options
// row at all). This mirrors the pricing engine's applicability rule (utils/pricing.js
// getApplicableOptions). A plain INNER JOIN silently dropped every global option, so they never
// appeared on the WordPress booking form even though the engine applied them.

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
  // [1] linked to property 10 ; [2] global (no link) ; [3] linked to property 20 ; [4] global.
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 40)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (2, 'Petit déjeuner', 'per_person_per_night', 9)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (3, 'Spa privatif', 'per_stay', 80)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (4, 'Linge de toilette', 'per_person', 5)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (10, 1)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (20, 3)').run();
  return db;
}

test('listForProperty returns property-linked options PLUS global ones, sorted by title', () => {
  const model = buildModel(freshDb());
  const titles = model.listForProperty(10).map((o) => o.title);
  // property 10 → its own option (Ménage) + the two globals (Petit déjeuner, Linge de toilette);
  // NOT property 20's "Spa privatif". Sorted by title.
  assert.deepEqual(titles, ['Linge de toilette', 'Ménage', 'Petit déjeuner']);
});

test('a different property gets ITS link plus the same globals (no cross-property leak)', () => {
  const model = buildModel(freshDb());
  const titles = model.listForProperty(20).map((o) => o.title).sort();
  assert.deepEqual(titles, ['Linge de toilette', 'Petit déjeuner', 'Spa privatif']);
  assert.ok(!titles.includes('Ménage'), "property 10's option must not leak to property 20");
});

test('a property with no links still sees every global option', () => {
  const model = buildModel(freshDb());
  const titles = model.listForProperty(999).map((o) => o.title).sort();
  assert.deepEqual(titles, ['Linge de toilette', 'Petit déjeuner']);
});

test('base price is returned as-is (options have a single price; no per-property price exists)', () => {
  const model = buildModel(freshDb());
  const breakfast = model.listForProperty(10).find((o) => o.title === 'Petit déjeuner');
  assert.equal(breakfast.price, 9);
});
