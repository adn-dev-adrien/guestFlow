// specs/tariff-recipe-gite/spec.md rule 26 — Pitchup joins both shipped recipes as a channel
// (15 %, commission included in the guest price). The Gîte bills its ménage there like everywhere
// else; L'Estiva is all-inclusive and Pitchup bans no chores, so it declares a 0 € fee.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { resolvePlatformCleaningFees } = require('../utils/platformCleaningFee');
const { buildModel: buildPropertiesModel } = require('../models/propertiesModel');

const shipped = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes', file), 'utf8'));

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, commissionPercent REAL NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT,
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '',
      extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0,
      platformCleaningFees TEXT DEFAULT '[]', updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER,
      changeoverArrival INTEGER, changeoverDeparture INTEGER, extraGuestTiers TEXT);
  `);
  db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('direct', 5), ('Airbnb', 15.5), ('GitesDeFrance', 10), ('Pitchup', 15)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Lodge')").run();
  return db;
}

const NAMES = ['Airbnb', 'GitesDeFrance', 'Pitchup'];

test('the grid shows the Pitchup cleaning fee of each property, the other channels unchanged', () => {
  const db = createDb();
  const props = buildPropertiesModel(db);
  props.setPlatformCleaningFees(1, resolvePlatformCleaningFees(shipped('gite-2027.json').cleaning, NAMES).fees);
  props.setPlatformCleaningFees(2, resolvePlatformCleaningFees(shipped('aventura-lodge-2026.json').cleaning, NAMES).fees);
  const fee = (id, name) => props.platformPrices(id).platforms.find((p) => p.name === name).cleaningFee;

  assert.equal(fee(1, 'Pitchup'), 95, 'Gîte: 80 € net ÷ 0,85, rounded up');
  assert.equal(fee(1, 'Airbnb'), 122);
  assert.equal(fee(1, 'GitesDeFrance'), 80);
  assert.equal(fee(2, 'Pitchup'), 0, 'L\'Estiva: all-inclusive, no chores to recover');
  assert.equal(fee(2, 'Airbnb'), 13);
});

test('a property whose GuestFlow has no Pitchup platform yet cannot take either recipe', () => {
  for (const file of ['gite-2027.json', 'aventura-lodge-2026.json']) {
    const { unknown } = resolvePlatformCleaningFees(shipped(file).cleaning, ['Airbnb', 'GitesDeFrance']);
    assert.deepEqual(unknown, ['Pitchup'], file);
  }
});
