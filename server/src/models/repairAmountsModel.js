/**
 * Repair amounts model — sole DB access for `repair_amounts`
 * (specs/extinguisher-seal-and-repair-amounts.md). Operator-managed priced list shown in the
 * « Tarifs facturables » settings section + billed in the SAS. Rows with a `repairKey` are
 * SAS-linked + protected (the UI forbids deleting them); the extinguisher-seal row is always
 * re-seeded on save so the SAS link can't break.
 *
 * Exports a default model bound to the production DB + a `buildModel(db)` factory for tests.
 */

// SAS-linked rows that must always exist (re-seeded on save so the SAS link can't break). The
// extinguisher-condition tariffs (specs/extinguisher-seal-and-repair-amounts.md §3.2): « Plomb
// manquant » + « Utilisation », billed per-quantity at departure.
const PROTECTED_REPAIRS = [
  { repairKey: 'extinguisher_seal', label: 'Plomb manquant' },
  { repairKey: 'extinguisher_use', label: 'Utilisation' },
];
const EXTINGUISHER_KEY = 'extinguisher_seal';

function buildModel(database) {
  const listStmt = database.prepare(
    'SELECT id, repairKey, label, price, sortOrder FROM repair_amounts ORDER BY sortOrder, id'
  );
  const insertStmt = database.prepare(
    'INSERT INTO repair_amounts (repairKey, label, price, sortOrder) VALUES (@repairKey, @label, @price, @sortOrder)'
  );
  const deleteAllStmt = database.prepare('DELETE FROM repair_amounts');

  function list() {
    return listStmt.all();
  }

  // Replace-all from the « Tarifs facturables » section. Keyed rows keep their `repairKey`; the
  // extinguisher-seal row is re-seeded (preserving its current label/price) if the payload dropped it.
  // Invalid rows (no label) are dropped; a duplicate key is ignored. Price coerced to ≥ 0.
  const replaceAll = database.transaction((items) => {
    const existingByKey = {};
    for (const r of listStmt.all()) { if (r.repairKey) existingByKey[r.repairKey] = r; }
    deleteAllStmt.run();
    let sort = 0;
    const seenKeys = new Set();
    for (const raw of (items || [])) {
      const label = String(raw && raw.label != null ? raw.label : '').trim();
      if (!label) continue;
      const repairKey = raw && raw.repairKey ? String(raw.repairKey).trim() : null;
      if (repairKey) {
        if (seenKeys.has(repairKey)) continue;
        seenKeys.add(repairKey);
      }
      const price = Math.max(0, Number(raw.price) || 0);
      insertStmt.run({ repairKey, label, price, sortOrder: sort++ });
    }
    for (const seed of PROTECTED_REPAIRS) {
      if (seenKeys.has(seed.repairKey)) continue;
      const prev = existingByKey[seed.repairKey];
      insertStmt.run({
        repairKey: seed.repairKey,
        label: (prev && prev.label) || seed.label,
        price: prev ? Math.max(0, Number(prev.price) || 0) : 0,
        sortOrder: sort++,
      });
    }
    return listStmt.all();
  });

  return { list, replaceAll, EXTINGUISHER_KEY, PROTECTED_REPAIRS };
}

const defaultModel = (() => {
  try { return buildModel(require('../database')); } catch { return null; }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel, EXTINGUISHER_KEY };
}
