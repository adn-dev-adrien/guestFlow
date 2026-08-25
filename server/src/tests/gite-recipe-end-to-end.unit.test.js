const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { validateRecipe } = require('../utils/tariffRecipe');
const { buildYearPlan, materializeClosures } = require('../utils/seasonPlan');
const { createTariffRecipeModel } = require('../models/tariffRecipeModel');
const { grossFromNet } = require('../utils/pricing');
const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipe-gite/spec.md — THE SHIPPED RECIPE FILE, end to end. A recipe is data, and
// data can be wrong: load server/src/recipes/gite-2027.json, derive 2026 and 2027 to the day,
// check the two arithmetic identities the whole grid rests on (a week is four nights; the direct
// row reproduces its own displayed price), then apply it to a property and quote the control cases.

const RECIPE_PATH = path.join(__dirname, '..', 'recipes', 'gite-2027.json');

function loadShippedRecipe() {
  const out = validateRecipe(JSON.parse(fs.readFileSync(RECIPE_PATH, 'utf8')));
  assert.equal(out.valid, true, out.error);
  return out.recipe;
}

const round2 = (v) => Math.round(v * 100) / 100;

function cumulativeTotals(season, upTo) {
  const totals = [season.pricePerNight];
  let last = season.pricePerNight;
  for (let night = 2; night <= upTo; night += 1) {
    const tier = season.progressiveTiers.find((t) => Number(t.nightNumber) === night);
    last = Number(tier ? tier.extraNightPrice : season.progressiveTiers[season.progressiveTiers.length - 1].extraNightPrice);
    totals.push(round2(totals[totals.length - 1] + last));
  }
  return totals;
}

test('the shipped recipe validates and prices a week at exactly four nights', () => {
  const recipe = loadShippedRecipe();
  assert.equal(recipe.id, 'gite-2027');
  assert.deepEqual(recipe.seasons.map((s) => s.label), ['Très basse', 'Basse', 'Moyenne', 'Haute', 'Très haute', 'Nouvel An']);
  for (const season of recipe.seasons) {
    const totals = cumulativeTotals(season, 14);
    // The whole grid in one line: nights 1-2 at the full rate, a week at four times it.
    assert.equal(totals[1], round2(season.pricePerNight * 2), `${season.label}: 2 nights = 2 × base`);
    assert.equal(totals[6], round2(season.pricePerNight * 4), `${season.label}: 7 nights = 4 × base`);
    // Past a week each further night is a seventh of one — NOT the 7th night's marginal price,
    // which the carry-forward would repeat if the table stopped at 7 nights.
    const weeklyNight = round2((season.pricePerNight * 4) / 7);
    assert.equal(round2(totals[7] - totals[6]), weeklyNight, `${season.label}: night 8 = week / 7`);
    assert.equal(round2(totals[13] - totals[12]), weeklyNight, `${season.label}: night 14 = week / 7`);
    // A longer stay never costs less than a shorter one.
    for (let i = 1; i < totals.length; i += 1) assert.ok(totals[i] > totals[i - 1], `${season.label}: night ${i + 1} adds money`);
  }
});

test('every season\'s net target reproduces its own displayed price through the 5 % engine fee', () => {
  const recipe = loadShippedRecipe();
  for (const season of recipe.seasons) {
    // The identity that proves the net was stored rather than silently dropped: gross it back up at
    // the own-channel commission and the displayed price must come out unchanged, to the euro.
    assert.equal(grossFromNet(season.netTargetPerNight, 5), season.pricePerNight, `${season.label}: ceil(net / 0,95) = prix affiché`);
    assert.equal(round2(season.pricePerNight * 0.95), season.netTargetPerNight, `${season.label}: net = prix × 0,95`);
  }
});

test('the shipped recipe derives the 2026 and 2027 calendars to the day', () => {
  const recipe = loadShippedRecipe();
  const r = (startDate, endDate, minNights) => (minNights ? { startDate, endDate, minNights } : { startDate, endDate });

  const plan2026 = buildYearPlan(recipe, 2026, materializeClosures(recipe, 2025, 2026));
  // The four rules, then the holiday blocks cutting into them one rank up, capped at Haute.
  assert.deepEqual(plan2026['very-low'], [r('2026-01-04', '2026-03-31'), r('2026-10-31', '2026-12-18')]);
  assert.deepEqual(plan2026.low, [
    r('2026-01-02', '2026-01-03', 3),  // Jour de l'an (jeudi) + pont du vendredi
    r('2026-04-01', '2026-04-03'), r('2026-04-06', '2026-04-30'),
  ]);
  assert.deepEqual(plan2026.mid, [
    r('2026-04-04', '2026-04-05', 2),  // Pâques (lundi 6)
    r('2026-05-03', '2026-05-07'), r('2026-05-10', '2026-05-13'), r('2026-05-17', '2026-05-22'),
    r('2026-05-25', '2026-07-03'), r('2026-08-29', '2026-10-30'),
  ]);
  assert.deepEqual(plan2026.high, [
    r('2026-01-01', '2026-01-01', 3),  // already Haute (year-end block): capped, minimum only
    r('2026-05-01', '2026-05-02', 2),  // Fête du Travail (vendredi)
    r('2026-05-08', '2026-05-09', 2),  // Victoire (vendredi)
    r('2026-05-14', '2026-05-16', 3),  // Ascension (jeudi) + pont
    r('2026-05-23', '2026-05-24', 2),  // Pentecôte (lundi 25)
    r('2026-07-04', '2026-07-10'), r('2026-08-22', '2026-08-28'),
    // The year-end block, split by Christmas's own 2-night minimum and by the réveillon.
    r('2026-12-19', '2026-12-24'), r('2026-12-25', '2026-12-26', 2), r('2026-12-27', '2026-12-29'),
  ]);
  assert.deepEqual(plan2026.peak, [r('2026-07-11', '2026-07-13', 3), r('2026-07-14', '2026-08-21')]);
  assert.deepEqual(plan2026['new-year'], [r('2026-12-30', '2026-12-31')]);

  // 2027 — the year the grid is written for, derived from the same rules, nothing painted.
  const plan2027 = buildYearPlan(recipe, 2027, materializeClosures(recipe, 2026, 2027));
  assert.deepEqual(plan2027.high, [
    r('2027-01-01', '2027-01-01', 2), r('2027-05-01', '2027-05-01'),
    r('2027-05-06', '2027-05-08', 3), r('2027-05-15', '2027-05-16', 2),
    r('2027-07-03', '2027-07-09'), r('2027-08-21', '2027-08-27'),
    r('2027-10-30', '2027-10-30', 2), r('2027-12-19', '2027-12-29'),
  ]);
  assert.deepEqual(plan2027.peak, [r('2027-07-10', '2027-08-20')]);
  assert.deepEqual(plan2027['new-year'], [r('2027-12-30', '2027-12-31')]);
  assert.deepEqual(plan2027.mid, [
    r('2027-05-02', '2027-05-05'), r('2027-05-09', '2027-05-14'),
    r('2027-05-17', '2027-07-02'), r('2027-08-28', '2027-10-29'),
  ]);
});

test('a holiday raise stops at Haute, and never demotes a night above it', () => {
  const recipe = loadShippedRecipe();
  const plan = buildYearPlan(recipe, 2026, materializeClosures(recipe, 2025, 2026));
  // 25 December is a public holiday inside the year-end block, which is ALREADY Haute: the cap
  // holds it there instead of letting it climb to Nouvel An at 1 200 €.
  assert.equal(plan['new-year'].some((x) => x.startDate.startsWith('2026-12-2')), false);
  assert.ok(plan.high.some((x) => x.startDate === '2026-12-25' && x.minNights === 2));
  // 14 juillet sits in Très haute, ABOVE the cap. It keeps its price and takes the block's minimum;
  // a cap implemented as min(cap, rank + 1) would have moved these three nights down to Haute.
  assert.ok(plan.peak.some((x) => x.startDate === '2026-07-11' && x.endDate === '2026-07-13' && x.minNights === 3));
  assert.equal(plan.high.some((x) => x.startDate.startsWith('2026-07-1')), false);
});

test('the whole year is covered, with no gap and no overlap, over the horizon', () => {
  const recipe = loadShippedRecipe();
  // A day nobody paints falls back to the engine's 100 €/night default — silently.
  for (const year of [2026, 2027, 2028]) {
    const plan = buildYearPlan(recipe, year, materializeClosures(recipe, year - 1, year));
    const painted = new Map();
    for (const season of recipe.seasons) {
      for (const range of plan[season.key] || []) {
        for (let t = Date.parse(`${range.startDate}T00:00:00Z`); t <= Date.parse(`${range.endDate}T00:00:00Z`); t += 86400000) {
          const day = new Date(t).toISOString().slice(0, 10);
          assert.equal(painted.has(day), false, `${day} peint deux fois (${painted.get(day)} et ${season.key})`);
          painted.set(day, season.key);
        }
      }
    }
    const days = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
    assert.equal(painted.size, days, `${year}: ${days} jours couverts`);
  }
});

test('applied to a property, the shipped recipe quotes the control cases to the cent', () => {
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
      seasonKey TEXT, seasonRank INTEGER, netTargetPerNight REAL, extraGuestPrice REAL, extraGuestNetTarget REAL, maxNights INTEGER,
      changeoverArrival INTEGER, changeoverDeparture INTEGER, extraGuestTiers TEXT);
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
  // The Gîte prices the whole house: no included-guest threshold, no extra-guest supplement, no
  // welcome pack — exactly what the recipe does NOT own (specs/tariff-recipes/spec.md §3.1 rule 6).
  db.prepare(`INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, welcomePackCost)
    VALUES (1, 'Gite', 0, 0, 'per_stay', 0)`).run();

  const recipe = loadShippedRecipe();
  const model = createTariffRecipeModel(db, { getRecipe: (id) => (id === recipe.id ? recipe : null) });
  assert.equal(model.apply(1, 'gite-2027').applied, true);

  // The horizon starts at the CURRENT year; the control cases are 2026-2027 dates. Pin both years
  // explicitly so the test does not rot on 1 January (the derivation itself is asserted above).
  for (const year of [2026, 2027]) {
    const plan = buildYearPlan(recipe, year, materializeClosures(recipe, year - 1, year));
    for (const season of recipe.seasons) {
      const existing = JSON.parse(db.prepare('SELECT dateRanges FROM pricing_rules WHERE propertyId = 1 AND seasonKey = ?').get(season.key).dateRanges);
      const kept = existing.filter((range) => !range.startDate.startsWith(String(year)));
      db.prepare('UPDATE pricing_rules SET dateRanges = ? WHERE propertyId = 1 AND seasonKey = ?')
        .run(JSON.stringify([...kept, ...(plan[season.key] || [])].sort((a, b) => a.startDate.localeCompare(b.startDate))), season.key);
    }
  }

  const BASE = {
    propertyId: 1, db, checkInTime: '16:00', checkOutTime: '10:00', adults: 4, children: 0, teens: 0, babies: 0,
    selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  };
  const CASES = [
    // Party size never moves the price: the Gîte is sold whole, up to 10 people.
    ['G1 · 2 nuits Très basse', 2, '2026-02-20', '2026-02-22', 504.00],
    ['G2 · 3 nuits Basse', 10, '2026-04-11', '2026-04-14', 727.20],
    // A « pont » one rank up: three Haute nights inside what would otherwise be Moyenne.
    ['G3 · pont de l\'Ascension', 6, '2026-05-14', '2026-05-17', 916.80],
    ['G4 · la semaine de plein été', 8, '2026-07-19', '2026-07-26', 2152.00],
    ['G5 · deux semaines de plein été', 5, '2026-08-01', '2026-08-15', 4304.01],
    // Straddles the peak/high boundary: 5 nights in Très haute then 2 in Haute, the discount tier
    // being taken from the position in the STAY and the price from the season of each night.
    ['G6 · à cheval sur la fin du cœur d\'été', 7, '2026-08-17', '2026-08-24', 2027.20],
    ['G7 · Noël', 9, '2026-12-23', '2026-12-26', 916.80],
    // The réveillon, at its provisional rate — the two nights of a stay arriving on the 30th.
    ['G8 · réveillon du Nouvel An', 10, '2026-12-30', '2027-01-01', 2400.00],
    // 14 juillet keeps its Très haute price despite the cap at Haute.
    ['G9 · le bloc du 14 juillet', 4, '2026-07-11', '2026-07-14', 1291.20],
    // 2027, derived and never painted by anyone.
    ['G10 · la semaine de plein été 2027', 4, '2027-07-17', '2027-07-24', 2152.00],
  ];
  for (const [label, adults, startDate, endDate, expected] of CASES) {
    const quote = calculateReservationQuote({ ...BASE, adults, startDate, endDate });
    assert.equal(quote.finalPrice, expected, `${label}: attendu ${expected}, obtenu ${quote.finalPrice}`);
  }

  // Minimum 2 nights everywhere, no ceiling and no imposed changeover day.
  const oneNight = calculateReservationQuote({ ...BASE, startDate: '2026-07-19', endDate: '2026-07-20' });
  assert.equal(oneNight.requiredMinNights, 2);
  assert.equal(oneNight.requiredMaxNights, null);
  // And 3 on the 14 juillet block — the minimum a « pont » carries even where the rank cannot rise.
  const bastille = calculateReservationQuote({ ...BASE, startDate: '2026-07-11', endDate: '2026-07-12' });
  assert.equal(bastille.requiredMinNights, 3);
  db.close();
});
