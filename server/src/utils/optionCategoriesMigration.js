/**
 * One-shot backfill of `options.category` (specs/option-categories.md §5.3).
 *
 * The animations and « Le repas des trappeurs » were created by hand long before the category
 * column existed, so they carry no `seedKey` and the catering seed will never touch them — this
 * backfill is the only thing that files them into a group.
 *
 * Runs once (guarded by the `migrations` table at the call site) and never re-asserts: the label
 * belongs to the operator afterwards. Rows that already carry a category are skipped, so a
 * re-categorised option is never dragged back.
 */

const ANIMATIONS_CATEGORY = 'Animations';
const CATERING_CATEGORY = 'Restauration';

// « Le repas des trappeurs » sits beside the animations in the catalogue and was long treated as
// one, but it's a meal — it belongs with the apéro boards, not with the activities.
const MEAL_TITLES = Object.freeze(['le repas des trappeurs']);

function runOptionCategoriesMigration(database) {
  const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
  if (!cols.includes('category')) return { animations: 0, meals: 0, skipped: 'schema' };

  const mealPlaceholders = MEAL_TITLES.map(() => '?').join(', ');
  const tx = database.transaction(() => {
    const animations = database.prepare(`
      UPDATE options SET category = ?
       WHERE (category IS NULL OR category = '')
         AND LOWER(TRIM(title)) LIKE 'animation%'
         AND LOWER(TRIM(title)) NOT IN (${mealPlaceholders})
    `).run(ANIMATIONS_CATEGORY, ...MEAL_TITLES).changes;

    const meals = database.prepare(`
      UPDATE options SET category = ?
       WHERE (category IS NULL OR category = '')
         AND LOWER(TRIM(title)) IN (${mealPlaceholders})
    `).run(CATERING_CATEGORY, ...MEAL_TITLES).changes;

    return { animations, meals };
  });
  return tx();
}

module.exports = {
  runOptionCategoriesMigration,
  ANIMATIONS_CATEGORY,
  CATERING_CATEGORY,
  MEAL_TITLES,
};
