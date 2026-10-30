const test = require('node:test');
const assert = require('node:assert/strict');

const { buildYearPlan } = require('../utils/seasonPlan');
const { validateRecipe } = require('../utils/tariffRecipe');

// specs/tariff-recipes/spec.md §3.3 rule 19bis — a minimum stay declared on a PERIOD survives the
// holiday modifier, even when it is lower than its season's. Found on the Gîte's 25 December: a
// Très haute night (season minimum 4) declared with 2, which the modifier silently put back to 4.

const recipeWith = (periodMinNights) => validateRecipe({
  id: 'period-min-test', version: '1.0.0', label: 'Test', horizonYears: 1,
  seasons: [
    { key: 'low', label: 'Basse', rank: 1, color: '#1B9E3E', pricePerNight: 100, minNights: 2 },
    { key: 'high', label: 'Haute', rank: 2, color: '#D4C11A', pricePerNight: 200, minNights: 2 },
    { key: 'peak', label: 'Très haute', rank: 3, color: '#E8951C', pricePerNight: 300, minNights: 4 },
  ],
  calendar: {
    baseSeason: 'low',
    periods: [
      { id: 'christmas-day', season: 'peak', anchor: { type: 'fixed_dates', from: '12-25', to: '12-25' }, ...(periodMinNights ? { minNights: periodMinNights } : {}) },
    ],
    modifiers: [{ type: 'public_holiday_bridge', effect: 'raise_rank', amount: 1, capSeason: 'high', minNights: 'block' }],
  },
}).recipe;

const christmasDay = (plan, year) => plan.peak.find((x) => x.startDate === `${year}-12-25`);

test('a period minimum below the season minimum is kept on a public holiday', () => {
  // 2027: 25 December is a Saturday, a one-night block — the period's 2 stands.
  assert.deepEqual(christmasDay(buildYearPlan(recipeWith(2), 2027, []), 2027),
    { startDate: '2027-12-25', endDate: '2027-12-25', minNights: 2 });
  // 2026: a Friday, a 2-night block (25, 26) — equal to the period's 2, still not the season's 4.
  assert.equal(christmasDay(buildYearPlan(recipeWith(2), 2026, []), 2026).minNights, 2);
});

test('the holiday block still raises a period minimum it exceeds', () => {
  // 2026 block is 2 nights; a period minimum of 1 is raised to the block's 2.
  assert.equal(christmasDay(buildYearPlan(recipeWith(1), 2026, []), 2026).minNights, 2);
});

test('without a period minimum the season minimum stands and records no override', () => {
  assert.deepEqual(christmasDay(buildYearPlan(recipeWith(null), 2026, []), 2026),
    { startDate: '2026-12-25', endDate: '2026-12-25' });
});
