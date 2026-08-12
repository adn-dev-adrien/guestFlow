const test = require('node:test');
const assert = require('node:assert/strict');

const { buildYearPlan, missingEventYears, materializeClosures } = require('../utils/seasonPlan');

// specs/tariff-events-and-extra-guest-tiers/spec.md §3.2 — a recurring event whose dates cannot be
// derived (L'Ardéchoise) is declared per year and repaints its nights, overriding everything else.

const BASE_RECIPE = {
  horizonYears: 2,
  seasons: [
    { key: 'low', rank: 1, label: 'Basse saison', pricePerNight: 179, minNights: 1 },
    { key: 'mid', rank: 2, label: 'Moyenne saison', pricePerNight: 216, minNights: 1 },
    { key: 'high', rank: 3, label: 'Haute saison', pricePerNight: 247, minNights: 1 },
  ],
  calendar: {
    baseSeason: 'low',
    periods: [],
    modifiers: [{ type: 'public_holiday_bridge', effect: 'raise_rank', amount: 1, minNights: 'block' }],
    events: [{
      key: 'ardechoise',
      label: "L'Ardéchoise",
      season: 'high',
      minNights: 1,
      sourceUrl: 'https://www.ardechoise.com/',
      dates: {
        2026: { from: '2026-06-08', to: '2026-06-13' },
        2027: { from: '2027-06-07', to: '2027-06-12' },
      },
    }],
  },
  closures: [],
};

const clone = (r) => JSON.parse(JSON.stringify(r));
const rangeCovering = (plan, seasonKey, dateIso) => (plan[seasonKey] || [])
  .find((r) => dateIso >= r.startDate && dateIso <= r.endDate);

test('the event week is painted high season, as its own range', () => {
  const plan = buildYearPlan(BASE_RECIPE, 2026);
  const range = rangeCovering(plan, 'high', '2026-06-10');
  assert.ok(range, 'the 10 June night is high season');
  assert.equal(range.startDate, '2026-06-08');
  assert.equal(range.endDate, '2026-06-13');
  assert.equal(range.eventKey, 'ardechoise');
  assert.equal(range.eventLabel, "L'Ardéchoise");
  assert.equal(range.minNights, 1);
});

test('the nights around the event are untouched', () => {
  const plan = buildYearPlan(BASE_RECIPE, 2026);
  assert.ok(rangeCovering(plan, 'low', '2026-06-07'), 'the eve of the event stays low season');
  assert.ok(rangeCovering(plan, 'low', '2026-06-14'), 'the day after too');
  assert.equal(rangeCovering(plan, 'high', '2026-06-07'), undefined);
});

test('2027 uses its own declared dates, not 2026 shifted', () => {
  const plan = buildYearPlan(BASE_RECIPE, 2027);
  const range = rangeCovering(plan, 'high', '2027-06-08');
  assert.equal(range.startDate, '2027-06-07');
  assert.equal(range.endDate, '2027-06-12');
  assert.equal(rangeCovering(plan, 'high', '2027-06-13'), undefined);
});

// The rule the whole pipeline position exists for.
test('the event LOWERS a public-holiday minimum — 1 night stays bookable', () => {
  const recipe = clone(BASE_RECIPE);
  // Ascension 2026 is Thursday 14 May → the bridge locks 14-16 May to a 3-night minimum.
  const withoutEvent = buildYearPlan(recipe, 2026);
  const bridge = rangeCovering(withoutEvent, 'mid', '2026-05-15') || rangeCovering(withoutEvent, 'high', '2026-05-15');
  assert.ok(bridge && bridge.minNights >= 2, 'the holiday bridge does impose a minimum');

  // Now declare the event ON that bridge.
  recipe.calendar.events[0].dates[2026] = { from: '2026-05-14', to: '2026-05-16' };
  const withEvent = buildYearPlan(recipe, 2026);
  const range = rangeCovering(withEvent, 'high', '2026-05-15');
  assert.ok(range, 'the event repaints the bridge');
  assert.equal(range.minNights, 1, 'the event wins: a single night is bookable on a bridge');
  assert.equal(range.eventKey, 'ardechoise');
});

test('a year with no declared dates changes nothing', () => {
  const recipe = clone(BASE_RECIPE);
  delete recipe.calendar.events[0].dates[2026];
  const plan = buildYearPlan(recipe, 2026);
  assert.equal(rangeCovering(plan, 'high', '2026-06-10'), undefined, 'no season was invented');
  assert.ok(rangeCovering(plan, 'low', '2026-06-10'), 'the base season kept the week');
});

test('an event never reopens a closure', () => {
  const recipe = clone(BASE_RECIPE);
  recipe.calendar.events[0].dates[2026] = { from: '2026-10-14', to: '2026-10-18' };
  const closures = [{ startDate: '2026-10-15', endDate: '2027-03-31' }];
  const plan = buildYearPlan(recipe, 2026, closures);
  assert.ok(rangeCovering(plan, 'high', '2026-10-14'), 'the night before the closure is the event');
  assert.equal(rangeCovering(plan, 'high', '2026-10-16'), undefined, 'a closed night stays closed');
});

test('an event can also cap the stay', () => {
  const recipe = clone(BASE_RECIPE);
  recipe.calendar.events[0].maxNights = 3;
  const range = rangeCovering(buildYearPlan(recipe, 2026), 'high', '2026-06-10');
  assert.equal(range.maxNights, 3);
});

test('two events do not fight — the last declared wins on a shared night', () => {
  const recipe = clone(BASE_RECIPE);
  recipe.calendar.events.push({
    key: 'festival', label: 'Festival', season: 'mid', minNights: 2,
    dates: { 2026: { from: '2026-06-12', to: '2026-06-15' } },
  });
  const plan = buildYearPlan(recipe, 2026);
  assert.equal(rangeCovering(plan, 'high', '2026-06-10').eventKey, 'ardechoise');
  const shared = rangeCovering(plan, 'mid', '2026-06-13');
  assert.equal(shared.eventKey, 'festival', 'the overlap goes to the later declaration, deterministically');
  assert.equal(shared.minNights, 2);
});

test('the plan stays pure — same recipe, same year, same output', () => {
  assert.deepEqual(buildYearPlan(BASE_RECIPE, 2026), buildYearPlan(BASE_RECIPE, 2026));
});

test('a recipe with no events at all behaves exactly as before', () => {
  const recipe = clone(BASE_RECIPE);
  delete recipe.calendar.events;
  const plan = buildYearPlan(recipe, 2026);
  assert.ok(rangeCovering(plan, 'low', '2026-06-10'));
  assert.deepEqual(Object.keys(plan).sort(), ['high', 'low', 'mid']);
});

// ── Reporting the gaps ────────────────────────────────────────────────────────

test('missingEventYears names the years with no dates', () => {
  assert.deepEqual(missingEventYears(BASE_RECIPE, 2026, 2027), []);
  assert.deepEqual(missingEventYears(BASE_RECIPE, 2026, 2028), [
    { key: 'ardechoise', label: "L'Ardéchoise", year: 2028, sourceUrl: 'https://www.ardechoise.com/' },
  ]);
});

test('a half-declared window counts as missing', () => {
  const recipe = clone(BASE_RECIPE);
  recipe.calendar.events[0].dates[2027] = { from: '2027-06-07' };
  assert.deepEqual(
    missingEventYears(recipe, 2027, 2027).map((m) => m.year),
    [2027],
    'a window with no end date cannot paint anything, so it is a gap',
  );
});

test('no events → nothing missing', () => {
  const recipe = clone(BASE_RECIPE);
  delete recipe.calendar.events;
  assert.deepEqual(missingEventYears(recipe, 2026, 2030), []);
});

test('closures still materialize alongside events', () => {
  const recipe = clone(BASE_RECIPE);
  recipe.closures = [{ label: 'Fermeture hivernale', from: '10-15', to: '03-31' }];
  const rows = materializeClosures(recipe, 2026, 2027);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.startDate <= r.endDate));
});

// Regression: a per-range minNights EQUAL to the season default is dropped on write (a range that
// merely restates the default inherits it). Comparing an unstripped desired range against the
// stripped stored one made every re-apply report the same dates as removed AND added — the event
// range, whose minNights of 1 matches the season default, is the first range to hit it.
test('an event range whose minNights equals the season default re-applies as unchanged', () => {
  const Database = require('better-sqlite3');
  const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, tariffRecipeId TEXT DEFAULT '',
      tariffRecipeVersion TEXT DEFAULT '', welcomePackCost REAL DEFAULT 0, updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT,
      minNights INTEGER DEFAULT 1, seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL,
      extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER, changeoverArrival INTEGER,
      changeoverDeparture INTEGER, extraGuestTiers TEXT);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
      label TEXT NOT NULL DEFAULT '', startDate TEXT NOT NULL, endDate TEXT NOT NULL, createdAt TEXT, updatedAt TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, kind TEXT NOT NULL DEFAULT 'reservation');
    CREATE TABLE tariff_recipe_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL,
      recipeId TEXT NOT NULL, recipeVersion TEXT NOT NULL DEFAULT '', generatedYear INTEGER,
      note TEXT NOT NULL DEFAULT '', blocking INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')), dismissedAt TEXT);
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();

  const recipe = {
    ...clone(BASE_RECIPE),
    id: 'evt', version: '1.0.0', label: 'Test',
  };
  recipe.seasons = recipe.seasons.map((s) => ({ ...s, color: '#123456', pricingMode: 'fixed' }));
  const model = createTariffRecipeModel(db, { getRecipe: () => recipe });

  assert.equal(model.apply(1, 'evt').applied, true);
  const second = model.preview(1, 'evt');
  const moved = second.seasons.filter((s) => s.rangesAdded.length || s.rangesRemoved.length);
  assert.deepEqual(moved, [], 're-applying an unchanged recipe must move no range');
  assert.ok(second.seasons.every((s) => s.action === 'unchanged'), 'every season is unchanged');
  db.close();
});
