const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { validateRecipe } = require('../store');
const { createTariffRecipeModel } = require('../model');

// specs/tariff-recipe-platform-cleaning-fee.md rule 15 — spec review 2026-10-27 (L2). On a fresh
// install the `platforms` table holds only `direct`, and both shipped recipes refused to apply
// (« Plateforme inconnue dans la recette : Airbnb »): a generic product failed on its own recipes.

const RECIPES_DIR = path.join(__dirname, '..', 'recipes');
const FILES = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith('.json'));

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, commissionPercent REAL NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, basePriceIncludedGuests INTEGER DEFAULT 0,
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '',
      extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0,
      platformCleaningFees TEXT DEFAULT '[]', updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER,
      changeoverArrival INTEGER, changeoverDeparture INTEGER, extraGuestTiers TEXT);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
      label TEXT NOT NULL DEFAULT 'Fermeture établissement', startDate TEXT NOT NULL, endDate TEXT NOT NULL,
      createdAt TEXT, updatedAt TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, kind TEXT NOT NULL DEFAULT 'reservation');
    CREATE TABLE tariff_recipe_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL,
      recipeId TEXT NOT NULL, recipeVersion TEXT NOT NULL DEFAULT '', generatedYear INTEGER,
      note TEXT NOT NULL DEFAULT '', blocking INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')), dismissedAt TEXT);
  `);
  // A fresh install records only the own channel.
  db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('direct', 0)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  return db;
}

const storeOf = (recipe) => ({ getRecipe: (id) => (id === recipe.id ? recipe : null) });

for (const file of FILES) {
  test(`${file} applies on a fresh install; the unknown channel is named, its fee skipped`, () => {
    const out = validateRecipe(JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, file), 'utf8')));
    assert.ok(out.valid, `${file} loads`);
    const db = createDb();
    const result = createTariffRecipeModel(db, storeOf(out.recipe)).apply(1, out.recipe.id);
    assert.equal(result.blocking, false);
    assert.equal(result.applied, true);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId = 1').get().n > 0);
    const declared = (out.recipe.cleaning?.platformFees || []).map((f) => f.platform);
    for (const name of declared) {
      assert.ok(result.warnings.some((w) => w.startsWith(`Plateforme inconnue dans la recette : ${name}`)), name);
    }
    assert.equal(db.prepare('SELECT platformCleaningFees FROM properties WHERE id = 1').get().platformCleaningFees, '[]');
    db.close();
  });
}

test('once the channel exists, re-applying picks its fee up as a change', () => {
  const file = FILES.find((f) => f.startsWith('gite'));
  const recipe = validateRecipe(JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, file), 'utf8'))).recipe;
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(recipe));
  model.apply(1, recipe.id);
  db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('Airbnb', 15.5)").run();
  const again = model.apply(1, recipe.id);
  assert.equal(again.applied, true);
  assert.deepEqual(again.cleaningFeeChanges.map((c) => c.platform), ['Airbnb']);
  db.close();
});
