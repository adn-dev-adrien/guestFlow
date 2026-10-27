/**
 * Shared fixtures of the google-vacation-rentals suites (not a test file): the real core database in
 * memory, with the gîte and the tente priced by the SHIPPED recipes (tariff-recipes/recipes/), so
 * every amount the feed computes comes out of the real engine.
 *
 * The caller sets `process.env.DB_PATH = ':memory:'` before requiring this module.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../database');
const { applyPluginSchema } = require('../../sdk/testing');
const { validateRecipe } = require('../../tariff-recipes/store');
const { createTariffRecipeModel } = require('../../tariff-recipes/model');
const { buildYearPlan, materializeClosures } = require('../../tariff-recipes/seasonPlan');

const RECIPES = path.join(__dirname, '..', '..', 'tariff-recipes', 'recipes');
const YEARS = [2026, 2027, 2028];

function loadRecipe(file) {
  const out = validateRecipe(JSON.parse(fs.readFileSync(path.join(RECIPES, file), 'utf8')));
  if (!out.valid) throw new Error(out.error);
  return out.recipe;
}

// Applies the recipe, then pins the season ranges of YEARS (the horizon of an apply starts at the
// current year, so fixed test dates would otherwise fall outside it).
function applyRecipe(propertyId, recipe) {
  const model = createTariffRecipeModel(db, { getRecipe: (rid) => (rid === recipe.id ? recipe : null) });
  const result = model.apply(propertyId, recipe.id);
  if (!result.applied && result.blocking) throw new Error(`recipe ${recipe.id} blocked: ${result.warnings}`);
  const closures = materializeClosures(recipe, YEARS[0] - 1, YEARS[YEARS.length - 1]);
  const merged = Object.fromEntries(recipe.seasons.map((s) => [s.key, []]));
  YEARS.forEach((year) => {
    const plan = buildYearPlan(recipe, year, closures);
    Object.keys(plan).forEach((key) => merged[key].push(...plan[key]));
  });
  recipe.seasons.forEach((season) => {
    db.prepare('UPDATE pricing_rules SET dateRanges = ? WHERE propertyId = ? AND seasonKey = ?')
      .run(JSON.stringify(merged[season.key]), propertyId, season.key);
  });
  db.prepare('DELETE FROM establishment_closures WHERE propertyId = ?').run(propertyId);
  closures.forEach((c) => db.prepare('INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, ?, ?, ?)')
    .run(propertyId, c.label, c.startDate, c.endDate));
}

let seeded = null;

/**
 * → { db, gite, tente }: the gîte (progressive, the week at four nights, a supplement above 10 guests,
 * tourist tax per adult and night) and the tente (supplement above 2, winter closure).
 */
function seed() {
  if (seeded) return seeded;
  applyPluginSchema(db, 'tariff-recipes');
  applyPluginSchema(db, 'google-vacation-rentals');
  const insert = db.prepare(`INSERT INTO properties (name, maxGuests, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit,
    touristTaxMode, touristTaxPerDayPerPerson, defaultCheckIn, defaultCheckOut) VALUES (?, ?, ?, ?, ?, ?, ?, '16:00', '10:00')`);
  // The shipped recipes declare Airbnb's cleaning fee; an apply refuses a platform GuestFlow does not
  // know (specs/tariff-recipe-platform-cleaning-fee.md rule 6).
  db.prepare("INSERT OR IGNORE INTO platforms (name, commissionPercent) VALUES ('Airbnb', 15.5)").run();
  const gite = Number(insert.run('La Granja', 14, 10, 29, 'per_night', 'per_day_per_person', 1.2).lastInsertRowid);
  const tente = Number(insert.run('L’Estiva', 4, 2, 15, 'per_night', 'per_day_per_person', 0.8).lastInsertRowid);
  applyRecipe(gite, loadRecipe('gite-2027.json'));
  applyRecipe(tente, loadRecipe('aventura-lodge-2026.json'));
  seeded = { db, gite, tente };
  return seeded;
}

module.exports = { seed, loadRecipe, YEARS };
