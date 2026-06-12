/**
 * Linen priced items model — sole DB access for `linen_priced_items`
 * (specs/arrival-departure-sas.md §3.4). Operator-managed list of priced linen elements
 * (`category='bed'`) and towels (`category='towel'`) shown in the SAS.
 *
 * Exports a default model bound to the production DB + a `buildModel(db)` factory for tests.
 */

const VALID_CATEGORIES = new Set(['bed', 'towel']);

function buildModel(database) {
  const listStmt = database.prepare(
    'SELECT id, label, price, category, sortOrder FROM linen_priced_items ORDER BY category, sortOrder, id'
  );
  const insertStmt = database.prepare(
    'INSERT INTO linen_priced_items (label, price, category, sortOrder) VALUES (@label, @price, @category, @sortOrder)'
  );
  const deleteAllStmt = database.prepare('DELETE FROM linen_priced_items');

  function list() {
    return listStmt.all();
  }

  // Replace-all: the Blanchisserie page sends the full desired list (both categories). Rows are
  // re-numbered by their position within each category. Invalid rows (no label) are dropped.
  const replaceAll = database.transaction((items) => {
    deleteAllStmt.run();
    const perCategoryIndex = { bed: 0, towel: 0 };
    for (const raw of (items || [])) {
      const label = String(raw && raw.label != null ? raw.label : '').trim();
      if (!label) continue;
      const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'bed';
      const price = Math.max(0, Number(raw.price) || 0);
      insertStmt.run({ label, price, category, sortOrder: perCategoryIndex[category]++ });
    }
    return listStmt.all();
  });

  return { list, replaceAll };
}

const defaultModel = (() => {
  try { return buildModel(require('../database')); } catch { return null; }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
