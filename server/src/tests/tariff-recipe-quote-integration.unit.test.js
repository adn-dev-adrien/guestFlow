const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { validateRecipe } = require('../utils/tariffRecipe');
const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { calculateReservationQuote } = require('../utils/pricing').__test;

// THE PATH NOTHING ELSE TESTS: recipe file → apply → pricing_rules → quote.
//
// Every layer has its own unit tests, and each of them mocks or hand-builds the layer below. The
// seams between them do not: `buildYearPlan` proves an event range carries `minNights: 1`, but
// nothing proves that minimum survives `normalizeDateRanges`, the `stripRangeMinEqualToDefault`
// pass, the JSON round-trip through the `dateRanges` column, and the rule matching in
// `calculateReservationQuote`. Two real defects already lived exactly there — `eventKey` being
// dropped by the range whitelist, and the strip breaking re-apply idempotency — and both were
// invisible to every isolated test.
//
// specs/tariff-events-and-extra-guest-tiers/spec.md §3.1-§3.2.

const RECIPE_PATH = path.join(__dirname, '..', 'recipes', 'aventura-lodge-2026.json');

function loadShippedRecipe() {
  const out = validateRecipe(JSON.parse(fs.readFileSync(RECIPE_PATH, 'utf8')));
  assert.equal(out.valid, true, out.error);
  return out.recipe;
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'percentage_accommodation',
      touristTaxPercentage REAL DEFAULT 5, touristTaxDepartmentPercentage REAL DEFAULT 10, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 2, extraGuestPrice REAL DEFAULT 15, extraGuestPriceUnit TEXT DEFAULT 'per_night',
      tariffRecipeId TEXT DEFAULT '', tariffRecipeVersion TEXT DEFAULT '', welcomePackCost REAL DEFAULT 9.32, updatedAt TEXT);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL,
      maxNights INTEGER, changeoverArrival INTEGER, changeoverDeparture INTEGER, extraGuestTiers TEXT);
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
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  return db;
}

// The horizon starts at the CURRENT year, so a fixed test date can fall outside it. Pin the ranges
// of the years the assertions use, exactly as the shipped end-to-end test does.
function applyAndPin(db, recipe, years) {
  const { buildYearPlan, materializeClosures } = require('../utils/seasonPlan');
  const model = createTariffRecipeModel(db, { getRecipe: (id) => (id === recipe.id ? recipe : null) });
  assert.equal(model.apply(1, recipe.id).applied, true);
  const closures = materializeClosures(recipe, years[0] - 1, years[years.length - 1]);
  const merged = Object.fromEntries(recipe.seasons.map((s) => [s.key, []]));
  for (const year of years) {
    const plan = buildYearPlan(recipe, year, closures);
    for (const key of Object.keys(plan)) merged[key].push(...plan[key]);
  }
  for (const season of recipe.seasons) {
    db.prepare('UPDATE pricing_rules SET dateRanges = ? WHERE propertyId = 1 AND seasonKey = ?')
      .run(JSON.stringify(merged[season.key]), season.key);
  }
  return model;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  platform: 'direct',
};

// ── The event reaches the quote ───────────────────────────────────────────────

test('an Ardéchoise night is quoted at the HIGH season price, not the base season', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);
  // 10 June 2027 sits inside the event; 20 June 2027 is the base season a fortnight later.
  const inEvent = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2027-06-10', endDate: '2027-06-11' });
  const outside = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2027-06-20', endDate: '2027-06-21' });
  assert.equal(inEvent.baseAccommodationPrice, 247, 'haute saison');
  assert.equal(outside.baseAccommodationPrice, 179, 'basse saison');
  db.close();
});

test("the event's 1-night minimum survives to the quote and beats the holiday bridge", () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);

  const single = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2027-06-10', endDate: '2027-06-11' });
  assert.equal(single.requiredMinNights, 1);
  assert.equal(single.minNightsBreached, false, 'a lone night is sellable during the race');

  // Ascension 2027 is Thursday 6 May → the bridge locks its nights to a 3-night minimum. Same
  // property, same recipe: the contrast is what proves the event is the thing that lowered it.
  const bridge = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2027-05-06', endDate: '2027-05-07' });
  assert.equal(bridge.requiredMinNights, 3);
  assert.equal(bridge.minNightsBreached, true);
  db.close();
});

test("the season's 7-night ceiling still applies inside the event week", () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);
  // The event range inherits the season maximum: an 8-night stay straddling it must still breach.
  const long = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2027-06-07', endDate: '2027-06-15' });
  assert.equal(long.maxNightsBreached, true, '8 nights exceeds the 7-night ceiling');
  db.close();
});

// ── The tier table reaches the quote ──────────────────────────────────────────

test('the tiers the apply WROTE are the tiers the quote bills', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);

  const stored = db.prepare("SELECT extraGuestTiers FROM pricing_rules WHERE propertyId = 1 AND seasonKey = 'high'").get();
  // Each band carries its NET pivot beside the displayed price — the platform grid grosses up from
  // netPrice, never from the displayed 15/8 (which already contains the direct margin).
  assert.deepEqual(JSON.parse(stored.extraGuestTiers), [
    { fromNight: 1, price: 15, netPrice: 14 },
    { fromNight: 2, price: 8, netPrice: 7 },
  ]);

  // 5 guests = 3 extra. The figures are the spec §3.1 table, derived independently there.
  const q = (nights) => calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2027-07-13',
    endDate: `2027-07-${String(13 + nights).padStart(2, '0')}`,
  }).extraGuestSurcharge;
  assert.equal(q(1), 45);
  assert.equal(q(2), 69);
  assert.equal(q(7), 189);
  db.close();
});

test('the supplement is flat across seasons — the tiers are not re-scaled by the season price', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);
  const low = calculateReservationQuote({ ...BASE, db, adults: 4, startDate: '2027-04-14', endDate: '2027-04-16' });
  const high = calculateReservationQuote({ ...BASE, db, adults: 4, startDate: '2027-07-20', endDate: '2027-07-22' });
  assert.equal(low.baseAccommodationPrice !== high.baseAccommodationPrice, true, 'the nights do differ');
  assert.equal(low.extraGuestSurcharge, 46, '2 extra × (15 + 8)');
  assert.equal(high.extraGuestSurcharge, 46, 'the same, because the supplement is not seasonal');
  db.close();
});

test('a stay crossing two seasons numbers the tiers by rank in the STAY, not by season', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);
  // 2027: the event ends 12 June, the base season resumes on the 13th — a stay straddling the
  // boundary must not restart the tier table at 15 € on the first night of the second season.
  const q = calculateReservationQuote({ ...BASE, db, adults: 3, startDate: '2027-06-11', endDate: '2027-06-14' });
  assert.equal(q.extraGuestSurcharge, 31, '1 extra × (15 + 8 + 8), one single first night');
  db.close();
});

// ── The supplement and the tourist-tax base ───────────────────────────────────

// The tax is per occupant per night — accommodation ÷ occupants × rate × adults — so comparing a
// 2-guest stay to a 5-guest one compares two different formulas and proves nothing. The invariant
// that actually matters is isolated by keeping the party identical and moving ONLY the supplement.
test('the extra-guest supplement stays OUT of the percentage tourist-tax base', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);
  const args = { ...BASE, db, adults: 5, startDate: '2027-07-20', endDate: '2027-07-21' };
  const billed = calculateReservationQuote(args);
  const offered = calculateReservationQuote({ ...args, extraGuestSurchargeOffered: true });

  assert.equal(billed.extraGuestSurcharge, 45, 'there IS a supplement to leave out');
  assert.equal(offered.extraGuestSurcharge, 0, 'and a way to remove it without touching the party');
  assert.equal(
    billed.touristTaxTotal, offered.touristTaxTotal,
    'the declared base follows the accommodation alone — 45 € of supplement moves no tax',
  );
  db.close();
});

// ── Idempotency on the real document ──────────────────────────────────────────

test('applying the SHIPPED recipe three times writes nothing after the first', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  const model = createTariffRecipeModel(db, { getRecipe: (id) => (id === recipe.id ? recipe : null) });
  assert.equal(model.apply(1, recipe.id).applied, true);
  const after1 = db.prepare('SELECT id, dateRanges, extraGuestTiers, minNights, maxNights FROM pricing_rules WHERE propertyId = 1 ORDER BY id').all();

  for (let run = 2; run <= 3; run += 1) {
    const preview = model.preview(1, recipe.id);
    assert.deepEqual(
      preview.seasons.filter((s) => s.action !== 'unchanged').map((s) => s.seasonKey), [],
      `run ${run}: every season must read as unchanged`,
    );
    model.apply(1, recipe.id);
  }
  const after3 = db.prepare('SELECT id, dateRanges, extraGuestTiers, minNights, maxNights FROM pricing_rules WHERE propertyId = 1 ORDER BY id').all();
  assert.deepEqual(after3, after1, 'the rows are byte-identical after three applies');
  db.close();
});

// ── A sold stay is not re-priced ──────────────────────────────────────────────

test('a locked snapshot keeps the price it was sold at when the tariff changes underneath', () => {
  const db = createDb();
  const recipe = loadShippedRecipe();
  applyAndPin(db, recipe, [2026, 2027]);

  // What the guest was quoted and signed for, at the OLD supplement and an old night price.
  const lockedNightlyBreakdown = [
    { date: '2027-07-20', price: 220 },
    { date: '2027-07-21', price: 120 },
  ];
  const sold = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2027-07-20', endDate: '2027-07-22',
    lockedNightlyBreakdown,
  });
  // Now the season price moves under it — a re-quote of the SAME reservation must not follow.
  db.prepare("UPDATE pricing_rules SET pricePerNight = 999 WHERE propertyId = 1 AND seasonKey = 'high'").run();
  const requoted = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2027-07-20', endDate: '2027-07-22',
    lockedNightlyBreakdown,
  });
  assert.equal(sold.baseAccommodationPrice, 340, '220 + 120, the frozen nights');
  assert.equal(requoted.baseAccommodationPrice, 340, 'the snapshot wins over the new season price');
  db.close();
});
