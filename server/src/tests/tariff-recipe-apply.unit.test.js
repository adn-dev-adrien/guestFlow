const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { validateRecipe } = require('../utils/tariffRecipe');

// specs/tariff-recipes/spec.md §3.2 rules 7-12 — diff shape, orphan removal, manual seasons as
// obstacles, transactional rollback, idempotent re-apply, pre-horizon ranges preserved.

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
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL,
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
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge'), (2, 'Gite')").run();
  return db;
}

const RECIPE = validateRecipe({
  id: 'aventura-test', version: '1.0.0', label: 'Aventura', horizonYears: 2,
  seasons: [
    { key: 'low', label: 'Basse saison', rank: 1, color: '#5B8C6E', pricePerNight: 179, netTargetPerNight: 160, pricingMode: 'progressive', extraNightRatio: 0.70, extraGuestPrice: 27, extraGuestNetTarget: 25 },
    { key: 'high', label: 'Haute saison', rank: 2, color: '#C25B4E', pricePerNight: 247, netTargetPerNight: 225, pricingMode: 'progressive', extraNightRatio: 0.70, extraGuestPrice: 27, extraGuestNetTarget: 25 },
  ],
  calendar: {
    baseSeason: 'low',
    periods: [{ id: 'summer', season: 'high', anchor: { type: 'fixed_dates', from: '07-01', to: '08-31' } }],
    modifiers: [],
  },
  closures: [{ label: 'Fermeture hivernale', from: '10-15', to: '03-31' }],
}).recipe;

const storeOf = (recipe) => ({ getRecipe: (id) => (id === recipe.id ? recipe : null) });

test('preview: create actions for a bare property, horizon = current + next year, closures added', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  const out = model.preview(1, 'aventura-test');
  assert.equal(out.blocking, false);
  assert.equal(out.horizon.fromYear, new Date().getFullYear());
  assert.equal(out.horizon.toYear, out.horizon.fromYear + 1);
  assert.deepEqual(out.seasons.map((s) => s.action), ['create', 'create']);
  assert.equal(out.closures.added.length, 2); // one winter closure per horizon year
  db.close();
});

test('apply writes seasons + closures + the recipe pointer; re-apply is an empty diff (rule 11)', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  const first = model.apply(1, 'aventura-test');
  assert.equal(first.applied, true);

  const rules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = 1 ORDER BY seasonRank').all();
  assert.equal(rules.length, 2);
  assert.equal(rules[0].seasonKey, 'low');
  assert.equal(rules[0].netTargetPerNight, 160);
  assert.equal(rules[0].extraGuestPrice, 27);
  assert.equal(JSON.parse(rules[0].progressiveTiers)[0].extraNightPrice, 125.30);
  const property = db.prepare('SELECT tariffRecipeId, tariffRecipeVersion FROM properties WHERE id = 1').get();
  assert.equal(property.tariffRecipeId, 'aventura-test');
  assert.equal(property.tariffRecipeVersion, '1.0.0');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM establishment_closures WHERE propertyId = 1').get().n, 2);

  const second = model.apply(1, 'aventura-test');
  assert.equal(second.applied, false); // nothing to do
  assert.ok(second.seasons.every((s) => s.action === 'unchanged'));
  db.close();
});

test('a manual season whose LABEL matches a recipe season is adopted, not blocked (rule 9bis)', () => {
  const db = createDb();
  const year = new Date().getFullYear();
  const info = db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges)
    VALUES (1, '  basse SAISON ', 110, ?)`)
    .run(JSON.stringify([{ startDate: `${year}-01-01`, endDate: `${year}-12-31` }]));
  const model = createTariffRecipeModel(db, storeOf(RECIPE));

  const out = model.preview(1, 'aventura-test');
  assert.equal(out.blocking, false, 'label match must not block');
  const low = out.seasons.find((s) => s.seasonKey === 'low');
  assert.equal(low.adopted, true);
  assert.equal(low.action, 'update');
  assert.equal(low.ruleId, Number(info.lastInsertRowid));
  assert.ok(low.fieldChanges.some((c) => c.field === 'pricePerNight' && c.to === 179));

  model.apply(1, 'aventura-test');
  // The adopted row is reused (tagged), not duplicated.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId = 1').get().n, 2);
  const adopted = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(info.lastInsertRowid);
  assert.equal(adopted.seasonKey, 'low');
  assert.equal(adopted.pricePerNight, 179);
  db.close();
});

test('a manual season with an UNRELATED label stays an obstacle (rule 9)', () => {
  const db = createDb();
  const year = new Date().getFullYear();
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges)
    VALUES (1, 'Peinte à la main', 90, ?)`)
    .run(JSON.stringify([{ startDate: `${year}-06-01`, endDate: `${year}-06-30` }]));
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  const out = model.preview(1, 'aventura-test');
  assert.equal(out.blocking, true);
  assert.ok(out.warnings.some((w) => w.includes('Peinte à la main')));
  const applied = model.apply(1, 'aventura-test');
  assert.equal(applied.applied, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId = 1').get().n, 1);
  assert.equal(db.prepare("SELECT tariffRecipeId FROM properties WHERE id = 1").get().tariffRecipeId, '');
  db.close();
});

test('an orphan recipe season is marked remove and deleted on apply; manual seasons untouched', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  model.apply(1, 'aventura-test');
  // The recipe drops the high season → its row must go; a manual season on ANOTHER property stays.
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges)
    VALUES (2, 'Gite annuel', 80, '[{"startDate":"2020-01-01","endDate":"2030-12-31"}]')`).run();
  const smaller = validateRecipe({
    ...RECIPE, seasons: [RECIPE.seasons[0]],
    calendar: { baseSeason: 'low', periods: [], modifiers: [] },
  });
  assert.equal(smaller.valid, true);
  const model2 = createTariffRecipeModel(db, storeOf(smaller.recipe));
  const out = model2.preview(1, 'aventura-test');
  const removed = out.seasons.find((s) => s.action === 'remove');
  assert.equal(removed.seasonKey, 'high');
  model2.apply(1, 'aventura-test');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId = 1 AND seasonKey = 'high'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId = 2').get().n, 1);
  db.close();
});

test('pre-horizon ranges survive a re-apply verbatim (rule 12)', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  model.apply(1, 'aventura-test');
  // Simulate last year's generated ranges sitting on the low season.
  const lowId = db.prepare("SELECT id FROM pricing_rules WHERE propertyId = 1 AND seasonKey = 'low'").get().id;
  const stored = JSON.parse(db.prepare('SELECT dateRanges FROM pricing_rules WHERE id = ?').get(lowId).dateRanges);
  const lastYear = new Date().getFullYear() - 1;
  const withPast = [{ startDate: `${lastYear}-01-01`, endDate: `${lastYear}-12-31` }, ...stored];
  db.prepare('UPDATE pricing_rules SET dateRanges = ? WHERE id = ?').run(JSON.stringify(withPast), lowId);

  const out = model.preview(1, 'aventura-test');
  const low = out.seasons.find((s) => s.seasonKey === 'low');
  assert.equal(low.action, 'unchanged'); // the past range is copied verbatim, not diffed
  model.apply(1, 'aventura-test');
  const after = JSON.parse(db.prepare('SELECT dateRanges FROM pricing_rules WHERE id = ?').get(lowId).dateRanges);
  assert.ok(after.some((r) => r.startDate === `${lastYear}-01-01` && r.endDate === `${lastYear}-12-31`));
  db.close();
});

test('a winter reservation makes its closure skipped with a warning, seasons still apply', () => {
  const db = createDb();
  const year = new Date().getFullYear();
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate) VALUES (10, 1, ?, ?)")
    .run(`${year}-11-10`, `${year}-11-15`);
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  const out = model.apply(1, 'aventura-test');
  assert.equal(out.applied, true);
  assert.ok(out.warnings.some((w) => w.includes('#10')));
  assert.equal(out.closures.skipped.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM establishment_closures WHERE propertyId = 1').get().n, 1);
  db.close();
});

test('unknown recipe blocks; run journal records and dismisses', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  const out = model.preview(1, 'nope');
  assert.equal(out.blocking, true);

  model.recordRun({ propertyId: 1, recipeId: 'aventura-test', recipeVersion: '1.0.0', generatedYear: 2028, note: '2028 généré' });
  const runs = model.listPendingRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].propertyName, 'Aventura Lodge');
  assert.equal(model.dismissRun(runs[0].id), true);
  assert.equal(model.listPendingRuns().length, 0);
  db.close();
});

test('coveredUntilYear reads the recipe-owned horizon', () => {
  const db = createDb();
  const model = createTariffRecipeModel(db, storeOf(RECIPE));
  assert.equal(model.coveredUntilYear(1), null);
  model.apply(1, 'aventura-test');
  assert.equal(model.coveredUntilYear(1), new Date().getFullYear() + 1);
  db.close();
});
