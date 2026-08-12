const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { validateRecipe } = require('../utils/tariffRecipe');
const { runTariffRecipeHorizonPass } = require('../scheduledTasks');

// specs/tariff-recipes/spec.md §3.2 rule 12 — the horizon pass extends only when a year is missing,
// journals exactly one pending alert per generated year, and is idempotent on a second run.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT,
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '',
      extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0,
      updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER,
      changeoverArrival INTEGER, changeoverDeparture INTEGER);
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
  return db;
}

const RECIPE = validateRecipe({
  id: 'r1', version: '1.0.0', label: 'Recette', horizonYears: 2,
  seasons: [{ key: 'low', label: 'Basse', rank: 1, color: '#111', pricePerNight: 100 }],
  calendar: { baseSeason: 'low', periods: [], modifiers: [] },
  closures: [],
}).recipe;

function setup({ recipe = RECIPE, withProperty = true } = {}) {
  const db = createDb();
  if (withProperty) {
    db.prepare("INSERT INTO properties (id, name, tariffRecipeId, tariffRecipeVersion) VALUES (1, 'Lodge', 'r1', '1.0.0')").run();
  }
  const store = { getRecipe: (id) => (id === recipe.id ? recipe : null) };
  const model = createTariffRecipeModel(db, store);
  return { db, store, model, deps: { model, store, database: db } };
}

test('missing horizon → apply + exactly one pending alert; second run is a no-op', () => {
  const { db, model, deps } = setup();
  runTariffRecipeHorizonPass('test', deps);
  assert.equal(model.coveredUntilYear(1), new Date().getFullYear() + 1);
  assert.equal(model.listPendingRuns().length, 1);
  assert.equal(model.listPendingRuns()[0].generatedYear, new Date().getFullYear() + 1);

  runTariffRecipeHorizonPass('test', deps);
  assert.equal(model.listPendingRuns().length, 1); // pending guard + covered horizon → nothing new
  db.close();
});

test('after the alert is dismissed and the horizon is covered, nothing new is written', () => {
  const { db, model, deps } = setup();
  runTariffRecipeHorizonPass('test', deps);
  model.dismissRun(model.listPendingRuns()[0].id);
  const rulesBefore = db.prepare('SELECT dateRanges FROM pricing_rules WHERE propertyId = 1').get().dateRanges;
  runTariffRecipeHorizonPass('test', deps);
  assert.equal(model.listPendingRuns().length, 0);
  assert.equal(db.prepare('SELECT dateRanges FROM pricing_rules WHERE propertyId = 1').get().dateRanges, rulesBefore);
  db.close();
});

test('a property without a recipe is never touched', () => {
  const { db, model, deps } = setup({ withProperty: false });
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Gite')").run();
  runTariffRecipeHorizonPass('test', deps);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules').get().n, 0);
  assert.equal(model.listPendingRuns().length, 0);
  db.close();
});

test('a vanished recipe raises one blocking alert instead of writing', () => {
  const { db, model } = setup();
  const emptyStore = { getRecipe: () => null };
  const missingModel = createTariffRecipeModel(db, emptyStore);
  runTariffRecipeHorizonPass('test', { model: missingModel, store: emptyStore, database: db });
  const runs = missingModel.listPendingRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].blocking, 1);
  assert.ok(runs[0].note.includes('Recette introuvable'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules').get().n, 0);
  void model;
  db.close();
});
