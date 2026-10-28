const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRecipe } = require('../store');
const { buildYearPlan, materializeClosures } = require('../seasonPlan');

// specs/tariff-recipes/spec.md §3 rule 16quater, completed at the 2026-10-27 spec review (L1). A
// holiday block whose minimum does not exceed the period's (14 juillet: 3 nights inside a summer core
// that demands 4; the Saturday 15 August: none) rewrote its nights WITHOUT the period minimum, so
// the Gîte's 2026 Très haute was stored as 4 ranges with nothing to tell them apart.

const gite = validateRecipe(require('../recipes/gite-2027.json')).recipe;
const lodge = validateRecipe(require('../recipes/aventura-lodge-2026.json')).recipe;
const planOf = (recipe, year) => buildYearPlan(recipe, year, materializeClosures(recipe, year - 1, year));

test('the Gîte 2026 summer core is one range carrying its 4-night minimum', () => {
  assert.deepEqual(planOf(gite, 2026).peak, [{ startDate: '2026-07-11', endDate: '2026-08-21', minNights: 4 }]);
});

test('a block minimum stronger than the season still splits its nights (Lodge, 14 juillet)', () => {
  const high = planOf(lodge, 2026).high;
  assert.ok(high.some((r) => r.startDate === '2026-07-11' && r.endDate === '2026-07-13' && r.minNights === 3));
});
