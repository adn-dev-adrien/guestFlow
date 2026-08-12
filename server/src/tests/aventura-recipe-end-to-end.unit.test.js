const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { validateRecipe } = require('../utils/tariffRecipe');
const { buildYearPlan, materializeClosures } = require('../utils/seasonPlan');
const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/plan.md step 43 — THE SHIPPED RECIPE FILE, end to end: the recipe is data,
// and data can be wrong. Load server/src/recipes/aventura-lodge-2026.json, derive 2026 (spec §3.7
// rule 44 to the day), apply it to a property, and quote the six D-cases of spec §3.10 rule 55.

const RECIPE_PATH = path.join(__dirname, '..', 'recipes', 'aventura-lodge-2026.json');

function loadShippedRecipe() {
  const out = validateRecipe(JSON.parse(fs.readFileSync(RECIPE_PATH, 'utf8')));
  assert.equal(out.valid, true, out.error);
  return out.recipe;
}

test('the shipped recipe validates and derives the spec rule 44 table for 2026', () => {
  const recipe = loadShippedRecipe();
  assert.equal(recipe.id, 'aventura-lodge-2026');
  const plan = buildYearPlan(recipe, 2026, materializeClosures(recipe, 2025, 2026));
  const r = (startDate, endDate) => ({ startDate, endDate });
  assert.deepEqual(plan.low, [
    r('2026-01-01', '2026-04-03'), r('2026-04-06', '2026-04-30'), r('2026-05-03', '2026-05-07'),
    r('2026-05-10', '2026-05-13'), r('2026-05-17', '2026-05-22'), r('2026-05-25', '2026-07-03'),
    r('2026-08-29', '2026-12-31'),
  ]);
  assert.deepEqual(plan.mid, [
    r('2026-04-04', '2026-04-05'), r('2026-05-01', '2026-05-02'), r('2026-05-08', '2026-05-09'),
    r('2026-05-14', '2026-05-16'), r('2026-05-23', '2026-05-24'),
    r('2026-07-04', '2026-07-10'), r('2026-08-22', '2026-08-28'),
  ]);
  assert.deepEqual(plan.high, [r('2026-07-11', '2026-08-21')]);
});

test('applied to a property, the shipped recipe quotes the six D-cases to the cent', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay',
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '', welcomePackCost REAL DEFAULT 0, updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL,
      changeoverArrival INTEGER, changeoverDeparture INTEGER);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
      label TEXT NOT NULL DEFAULT '', startDate TEXT NOT NULL, endDate TEXT NOT NULL, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, kind TEXT NOT NULL DEFAULT 'reservation');
    CREATE TABLE tariff_recipe_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL,
      recipeId TEXT NOT NULL, recipeVersion TEXT NOT NULL DEFAULT '', generatedYear INTEGER,
      note TEXT NOT NULL DEFAULT '', blocking INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')), dismissedAt TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  // The property config a recipe deliberately does NOT cover (spec rule 6) — set as the script would.
  db.prepare(`INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, welcomePackCost)
    VALUES (1, 'Aventura Lodge', 2, 27, 'per_night', 9.32)`).run();

  const recipe = loadShippedRecipe();
  const model = createTariffRecipeModel(db, { getRecipe: (id) => (id === recipe.id ? recipe : null) });
  const result = model.apply(1, 'aventura-lodge-2026');
  assert.equal(result.applied, true);

  // The horizon starts at the CURRENT year; the D-cases are 2026 dates. When the current year has
  // moved past 2026 this test would quote outside the generated horizon, so pin the ranges of 2026
  // explicitly: derive them and overwrite (the derivation itself is asserted by the test above).
  if (new Date().getFullYear() !== 2026) {
    const plan2026 = buildYearPlan(recipe, 2026, materializeClosures(recipe, 2025, 2026));
    for (const season of recipe.seasons) {
      db.prepare('UPDATE pricing_rules SET dateRanges = ? WHERE propertyId = 1 AND seasonKey = ?')
        .run(JSON.stringify(plan2026[season.key]), season.key);
    }
  }

  const BASE = {
    propertyId: 1, db, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
    selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  };
  const CASES = [
    ['D1', 2, '2026-04-07', '2026-04-08', 179.00],
    ['D2', 2, '2026-04-07', '2026-04-09', 304.30],
    ['D3', 2, '2026-07-04', '2026-07-07', 518.40],
    ['D4', 4, '2026-07-13', '2026-07-16', 722.40],
    ['D5', 5, '2026-07-13', '2026-07-20', 1705.60],
    ['D6', 3, '2026-07-04', '2026-07-06', 413.10],
  ];
  for (const [label, adults, startDate, endDate, expected] of CASES) {
    const q = calculateReservationQuote({ ...BASE, adults, startDate, endDate });
    assert.equal(q.finalPrice, expected, `${label}: expected ${expected}, got ${q.finalPrice}`);
  }
  db.close();
});
