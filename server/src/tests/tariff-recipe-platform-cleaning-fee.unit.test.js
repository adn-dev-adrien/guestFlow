// specs/tariff-recipe-platform-cleaning-fee.md — a recipe declares what a ménage costs and which
// channels bill it apart; the « Prix plateformes » grid shows the cleaning fee to configure, commission
// included. The shipped figures (Gîte 122 €, L'Estiva 13 € on Airbnb at 15.5 %) are pinned here.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { validateRecipe } = require('../utils/tariffRecipe');
const { resolvePlatformCleaningFees, diffPlatformCleaningFees } = require('../utils/platformCleaningFee');
const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { buildModel: buildPropertiesModel } = require('../models/propertiesModel');

const shipped = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes', file), 'utf8'));

const BASE = {
  id: 'clean-test', version: '1.0.0', label: 'Test', horizonYears: 2,
  seasons: [{ key: 'low', label: 'Basse saison', rank: 1, color: '#5B8C6E', pricePerNight: 179, netTargetPerNight: 160 }],
  calendar: { baseSeason: 'low', periods: [], modifiers: [] },
  closures: [],
};
const withCleaning = (cleaning) => ({ ...BASE, cleaning });
const errorOf = (json) => validateRecipe(json).error;

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
  db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('direct', 5), ('Airbnb', 15.5), ('Booking', 16.44)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  return db;
}

const storeOf = (recipe) => ({ getRecipe: (id) => (id === recipe.id ? recipe : null) });
const storedFees = (db) => JSON.parse(db.prepare('SELECT platformCleaningFees FROM properties WHERE id = 1').get().platformCleaningFees);

// specs/tariff-recipe-platform-cleaning-fee.md rule 1
test('a valid cleaning block loads, and the shipped recipes carry theirs', () => {
  assert.equal(errorOf(withCleaning({ netCost: 80, hourlyRate: 25, platformFees: [{ platform: 'Airbnb', chargesCleaning: true, choresMinutes: 55 }] })), undefined);
  assert.equal(validateRecipe(shipped('gite-2027.json')).error, undefined);
  assert.equal(validateRecipe(shipped('aventura-lodge-2026.json')).error, undefined);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 2
test('no cleaning block, or no platformFees, produces no fee anywhere', () => {
  assert.equal(errorOf(BASE), undefined);
  assert.equal(errorOf(withCleaning({ netCost: 80 })), undefined);
  assert.deepEqual(resolvePlatformCleaningFees(undefined, ['Airbnb']), { fees: [], unknown: [] });
  assert.deepEqual(resolvePlatformCleaningFees({ netCost: 80, platformFees: [] }, ['Airbnb']), { fees: [], unknown: [] });
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 3
test('an invalid cleaning block is rejected with its field path', () => {
  const cases = [
    [{ netCost: -1 }, 'cleaning.netCost'],
    [{ hourlyRate: 'vingt' }, 'cleaning.hourlyRate'],
    [{ platformFees: 'Airbnb' }, 'cleaning.platformFees'],
    [{ platformFees: [{ platform: '  ', chargesCleaning: true }] }, 'cleaning.platformFees[0].platform'],
    [{ platformFees: [{ platform: 'Airbnb', chargesCleaning: 'oui' }] }, 'cleaning.platformFees[0].chargesCleaning'],
    [{ platformFees: [{ platform: 'Airbnb', chargesCleaning: true, choresMinutes: -5 }] }, 'cleaning.platformFees[0].choresMinutes'],
    [{ netCost: 80, platformFees: [{ platform: 'Airbnb', chargesCleaning: true }, { platform: 'airbnb', chargesCleaning: false }] }, 'cleaning.platformFees[1].platform'],
  ];
  for (const [cleaning, where] of cases) {
    const err = errorOf(withCleaning(cleaning));
    assert.ok(err && err.includes(where), `${JSON.stringify(cleaning)} → ${err}`);
  }
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 5
test('net to recover: ménage when the channel bills it, plus the chores at the hourly rate', () => {
  const gite = resolvePlatformCleaningFees(shipped('gite-2027.json').cleaning, ['direct', 'Airbnb']);
  assert.deepEqual(gite.fees, [{ platform: 'Airbnb', cleaningNet: 80, choresNet: 22.92, net: 102.92 }]);
  const lodge = resolvePlatformCleaningFees(shipped('aventura-lodge-2026.json').cleaning, ['airbnb']);
  assert.deepEqual(lodge.fees, [{ platform: 'airbnb', cleaningNet: 0, choresNet: 10.42, net: 10.42 }], 'matched case-insensitively, recorded name kept');
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 4
test('apply writes the fees even when no season changes', () => {
  const db = createDb();
  const recipe = validateRecipe(withCleaning({ netCost: 80, hourlyRate: 25, platformFees: [{ platform: 'Airbnb', chargesCleaning: true, choresMinutes: 55 }] })).recipe;
  const model = createTariffRecipeModel(db, storeOf(recipe));
  model.apply(1, recipe.id);
  db.prepare("UPDATE properties SET platformCleaningFees = '[]' WHERE id = 1").run();
  const second = model.apply(1, recipe.id);
  assert.ok(second.seasons.every((x) => x.action === 'unchanged'), 'nothing to do on the seasons');
  assert.deepEqual(storedFees(db), [{ platform: 'Airbnb', cleaningNet: 80, choresNet: 22.92, net: 102.92 }]);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 6
test('a platform GuestFlow does not know blocks the apply and writes nothing', () => {
  const db = createDb();
  const recipe = validateRecipe(withCleaning({ netCost: 80, hourlyRate: 25, platformFees: [{ platform: 'Vrbo', chargesCleaning: true }] })).recipe;
  const out = createTariffRecipeModel(db, storeOf(recipe)).apply(1, recipe.id);
  assert.equal(out.blocking, true);
  assert.ok(out.warnings.includes('Plateforme inconnue dans la recette : Vrbo'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules').get().n, 0);
  assert.deepEqual(storedFees(db), []);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 7
test('a recipe without the block clears a fee left by a previous apply', () => {
  const db = createDb();
  db.prepare(`UPDATE properties SET platformCleaningFees = '[{"platform":"Airbnb","cleaningNet":80,"choresNet":22.92,"net":102.92}]' WHERE id = 1`).run();
  const recipe = validateRecipe(BASE).recipe;
  createTariffRecipeModel(db, storeOf(recipe)).apply(1, recipe.id);
  assert.deepEqual(storedFees(db), []);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 8
test('the grid serves the whole-euro gross and its detail: Gîte 122 €, L\'Estiva 13 €', () => {
  const db = createDb();
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Estiva')").run();
  const props = buildPropertiesModel(db);
  props.setPlatformCleaningFees(1, resolvePlatformCleaningFees(shipped('gite-2027.json').cleaning, ['Airbnb']).fees);
  props.setPlatformCleaningFees(2, resolvePlatformCleaningFees(shipped('aventura-lodge-2026.json').cleaning, ['Airbnb']).fees);

  const gite = props.platformPrices(1).platforms;
  const airbnb = gite.find((p) => p.name === 'Airbnb');
  assert.equal(airbnb.cleaningFee, 122);
  assert.deepEqual(airbnb.cleaningFeeDetail, { cleaningNet: 80, choresNet: 22.92, net: 102.92 });
  assert.equal(gite.find((p) => p.name === 'Booking').cleaningFee, null, 'a channel without an entry');
  assert.equal(gite.find((p) => p.isDirect).cleaningFee, null, 'the direct ménage is an option, never a fee');

  assert.equal(props.platformPrices(2).platforms.find((p) => p.name === 'Airbnb').cleaningFee, 13);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 9
test('the commission is read at request time: changing it moves the fee without re-applying', () => {
  const db = createDb();
  const props = buildPropertiesModel(db);
  props.setPlatformCleaningFees(1, [{ platform: 'Airbnb', cleaningNet: 80, choresNet: 22.92, net: 102.92 }]);
  db.prepare("UPDATE platforms SET commissionPercent = 3 WHERE name = 'Airbnb'").run();
  assert.equal(props.platformPrices(1).platforms.find((p) => p.name === 'Airbnb').cleaningFee, 107);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 11
test('a cleaning-only change is reported, applied and journaled', () => {
  const db = createDb();
  db.exec(`CREATE TABLE tariff_change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, kind TEXT NOT NULL,
    recipeId TEXT NOT NULL DEFAULT '', recipeVersion TEXT NOT NULL DEFAULT '', occurredAt TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', note TEXT NOT NULL DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')))`);
  const plain = validateRecipe(BASE).recipe;
  createTariffRecipeModel(db, storeOf(plain)).apply(1, plain.id);

  const recipe = validateRecipe(withCleaning({ netCost: 80, hourlyRate: 25, platformFees: [{ platform: 'Airbnb', chargesCleaning: true, choresMinutes: 55 }] })).recipe;
  const model = createTariffRecipeModel(db, storeOf(recipe));
  const preview = model.preview(1, recipe.id);
  assert.ok(preview.seasons.every((s) => s.action === 'unchanged'), 'the seasons are already compliant');
  assert.deepEqual(preview.cleaningFeeChanges, [{ platform: 'Airbnb', from: null, to: 102.92 }]);
  assert.equal(model.apply(1, recipe.id).applied, true, 'the guest-facing Airbnb price moved');
  assert.deepEqual(model.preview(1, recipe.id).cleaningFeeChanges, [], 'idempotent once written');
  const journaled = db.prepare("SELECT recipeVersion FROM tariff_change_events WHERE propertyId = 1 AND kind = 'recipe' ORDER BY id").all();
  assert.equal(journaled.length, 2, 'the plain apply, then the cleaning-only apply');

  assert.deepEqual(diffPlatformCleaningFees('[{"platform":"Airbnb","net":102.92}]', []), [{ platform: 'Airbnb', from: 102.92, to: null }]);
  assert.deepEqual(diffPlatformCleaningFees('garbage', []), []);
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 12
test('a part the fee must cover cannot silently price at 0 €', () => {
  assert.ok(errorOf(withCleaning({ hourlyRate: 25, platformFees: [{ platform: 'Airbnb', chargesCleaning: true }] })).startsWith('cleaning.netCost'));
  assert.ok(errorOf(withCleaning({ netCost: 80, platformFees: [{ platform: 'Airbnb', chargesCleaning: false, choresMinutes: 25 }] })).startsWith('cleaning.hourlyRate'));
  assert.equal(errorOf(withCleaning({ netCost: 80, platformFees: [{ platform: 'Airbnb', chargesCleaning: true, choresMinutes: 0 }] })), undefined, 'no chores → no rate needed');
});

// specs/tariff-recipe-platform-cleaning-fee.md rule 13
test('an own channel carries no platform cleaning fee: the apply is blocked', () => {
  const db = createDb();
  const recipe = validateRecipe(withCleaning({ netCost: 80, hourlyRate: 25, platformFees: [{ platform: 'direct', chargesCleaning: true }] })).recipe;
  const out = createTariffRecipeModel(db, storeOf(recipe)).apply(1, recipe.id);
  assert.equal(out.blocking, true);
  assert.ok(out.warnings.includes('Le canal direct ne facture pas de frais de ménage plateforme : direct'));
  assert.deepEqual(storedFees(db), []);
});
