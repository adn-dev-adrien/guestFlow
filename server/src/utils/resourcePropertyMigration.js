/**
 * One-shot migration: move resource↔property applicability from the legacy `resources.propertyIds` JSON
 * column into the `resource_properties` pivot, then drop the column. A resource with an empty/absent list
 * stays "global" (no pivot rows). Stale property ids (no matching `properties` row) are skipped to avoid
 * FK violations.
 *
 * Idempotent: returns false and does nothing once `propertyIds` no longer exists.
 */
function migrateResourcePropertiesFromJson(db) {
  const cols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
  if (!cols.includes('propertyIds')) return false;

  const propExists = db.prepare('SELECT 1 FROM properties WHERE id = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO resource_properties (resourceId, propertyId) VALUES (?, ?)');
  const run = db.transaction(() => {
    const rows = db.prepare('SELECT id, propertyIds FROM resources').all();
    for (const row of rows) {
      let list = [];
      try { list = JSON.parse(row.propertyIds || '[]'); } catch { list = []; }
      if (!Array.isArray(list)) continue;
      for (const pid of list) {
        const propertyId = Number(pid);
        if (Number.isFinite(propertyId) && propertyId > 0 && propExists.get(propertyId)) {
          insert.run(row.id, propertyId);
        }
      }
    }
  });
  run();

  db.exec('ALTER TABLE resources DROP COLUMN propertyIds');
  return true;
}

module.exports = { migrateResourcePropertiesFromJson };
