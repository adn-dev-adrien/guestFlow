const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createTariffRecipeModel } = require('../model');
const { validateRecipe } = require('../store');

// specs/tariff-recipes/spec.md §3 rule 64 — spec review 2026-10-27 (M1). The recipe's
// `extraGuest.unit` and `appliesAbove` were validated and then never written: applying the Lodge
// recipe to a property left at `per_stay` billed its 15/8 tiers 0 € (a per-stay supplement never
// reads a tier table), and nothing in the preview said so.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, basePriceIncludedGuests INTEGER DEFAULT 0,
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '',
      extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay', welcomePackCost REAL DEFAULT 0, platformCleaningFees TEXT DEFAULT '[]',
      updatedAt TEXT);
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
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge'), (2, 'Gite')").run();
  return db;
}


const base = {
  id: 'lodge-test', version: '1.0.0', label: 'Lodge', horizonYears: 2,
  seasons: [{ key: 'low', label: 'Basse saison', rank: 1, color: '#5B8C6E', pricePerNight: 179 }],
  calendar: { baseSeason: 'low', periods: [], modifiers: [] },
};
const LODGE = validateRecipe({
  ...base,
  extraGuest: { appliesAbove: 2, unit: 'per_night', perNightTiers: [{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }] },
}).recipe;
const storeOf = (recipe) => ({ getRecipe: (id) => (id === recipe.id ? recipe : null) });

test('the preview names the supplement unit and the included guests the recipe will set', () => {
  const db = createDb();
  const out = createTariffRecipeModel(db, storeOf(LODGE)).preview(1, 'lodge-test');
  assert.deepEqual(out.extraGuestChanges, [
    { field: 'extraGuestPriceUnit', label: 'Supplément voyageurs', from: 'par séjour', to: 'par nuit' },
    { field: 'basePriceIncludedGuests', label: 'Personnes incluses dans le prix', from: '0', to: '2' },
  ]);
  db.close();
});

test('apply writes them on the property, and a re-apply has nothing left to do', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(LODGE));
  model.apply(1, 'lodge-test');
  const row = db.prepare('SELECT extraGuestPriceUnit, basePriceIncludedGuests FROM properties WHERE id = 1').get();
  assert.deepEqual({ ...row }, { extraGuestPriceUnit: 'per_night', basePriceIncludedGuests: 2 });
  const again = model.apply(1, 'lodge-test');
  assert.equal(again.applied, false);
  assert.deepEqual(again.extraGuestChanges, []);
  db.close();
});

test('a unit-only change still counts as a change — the apply is not « rien à modifier »', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(LODGE));
  model.apply(1, 'lodge-test');
  db.prepare("UPDATE properties SET extraGuestPriceUnit = 'per_stay' WHERE id = 1").run();
  const out = model.apply(1, 'lodge-test');
  assert.equal(out.applied, true);
  assert.equal(db.prepare('SELECT extraGuestPriceUnit FROM properties WHERE id = 1').get().extraGuestPriceUnit, 'per_night');
  db.close();
});

test('tiers without a declared unit mean per night', () => {
  const db = createDb();
  const recipe = validateRecipe({ ...base, extraGuest: { perNightTiers: [{ fromNight: 1, price: 15 }] } }).recipe;
  createTariffRecipeModel(db, storeOf(recipe)).apply(1, 'lodge-test');
  const row = db.prepare('SELECT extraGuestPriceUnit, basePriceIncludedGuests FROM properties WHERE id = 1').get();
  assert.equal(row.extraGuestPriceUnit, 'per_night');
  assert.equal(row.basePriceIncludedGuests, 0, 'appliesAbove not declared → left alone');
  db.close();
});

test('a recipe without an extraGuest block leaves the property supplement alone', () => {
  const db = createDb();
  db.prepare("UPDATE properties SET extraGuestPriceUnit = 'per_night', basePriceIncludedGuests = 4 WHERE id = 1").run();
  const recipe = validateRecipe(base).recipe;
  const out = createTariffRecipeModel(db, storeOf(recipe)).apply(1, 'lodge-test');
  assert.deepEqual(out.extraGuestChanges, []);
  const row = db.prepare('SELECT extraGuestPriceUnit, basePriceIncludedGuests FROM properties WHERE id = 1').get();
  assert.deepEqual({ ...row }, { extraGuestPriceUnit: 'per_night', basePriceIncludedGuests: 4 });
  db.close();
});

test('a tier table on a per-stay supplement is refused at load', () => {
  const out = validateRecipe({ ...base, extraGuest: { unit: 'per_stay', perNightTiers: [{ fromNight: 1, price: 15 }] } });
  assert.ok(out.error, 'refused');
  assert.match(JSON.stringify(out.error), /per_night requis/);
});
