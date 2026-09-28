/**
 * Plugins model — sole DB access for `plugins` (specs/plugins-phase-0-foundation.md §4.1).
 *
 * States: no row = available; enabled = 1 → active; enabled = 0 → installed but inactive.
 * `isActive` is called on hot paths (every request of a plugin route, every scheduled pass), so the
 * active set is cached in memory and rebuilt after each write. One process serves one database, so
 * no other writer can make the cache stale.
 *
 * Exports a default model bound to the production DB + a `buildModel(db)` factory for tests.
 *
 * API:
 *   list()                  → [{ id, enabled, source, version, installedAt, updatedAt }]
 *   get(id)                 → row | null
 *   install(id)             → inserts an active row
 *   setEnabled(id, enabled) → flips the flag
 *   uninstall(id)           → deletes the row (the plugin's data is kept, rule 6)
 *   isActive(id)            → boolean
 *   listActiveIds()         → [id]
 *   countOpenPaymentLinks() / countOnlyRoleUsers(role) → blocker counts (rule 8)
 */

function buildModel(database) {
  const listStmt = database.prepare(
    'SELECT id, enabled, source, version, installed_at AS installedAt, updated_at AS updatedAt FROM plugins ORDER BY id'
  );
  const getStmt = database.prepare(
    'SELECT id, enabled, source, version, installed_at AS installedAt, updated_at AS updatedAt FROM plugins WHERE id = ?'
  );
  const insertStmt = database.prepare("INSERT INTO plugins (id, enabled, source) VALUES (?, 1, 'builtin')");
  const setEnabledStmt = database.prepare("UPDATE plugins SET enabled = ?, updated_at = datetime('now') WHERE id = ?");
  const deleteStmt = database.prepare('DELETE FROM plugins WHERE id = ?');
  const activeStmt = database.prepare('SELECT id FROM plugins WHERE enabled = 1 ORDER BY id');
  const openLinksStmt = database.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open'");
  // Active users holding `role` without admin: a combined admin account keeps every screen, so it
  // never needs the plugin that carries the role.
  const onlyRoleStmt = database.prepare(`
    SELECT COUNT(DISTINCT u.id) AS n FROM users u
    JOIN user_roles r ON r.userId = u.id AND r.role = ?
    WHERE u.isActive = 1
      AND NOT EXISTS (SELECT 1 FROM user_roles a WHERE a.userId = u.id AND a.role = 'admin')
  `);

  let activeCache = null;
  const activeSet = () => {
    if (!activeCache) activeCache = new Set(activeStmt.all().map((r) => r.id));
    return activeCache;
  };
  const invalidate = () => { activeCache = null; };

  const toRow = (row) => (row ? { ...row, enabled: row.enabled === 1 } : null);

  return {
    list: () => listStmt.all().map(toRow),
    get: (id) => toRow(getStmt.get(id)),
    install(id) { insertStmt.run(id); invalidate(); },
    setEnabled(id, enabled) { setEnabledStmt.run(enabled ? 1 : 0, id); invalidate(); },
    uninstall(id) { deleteStmt.run(id); invalidate(); },
    isActive: (id) => activeSet().has(id),
    listActiveIds: () => [...activeSet()],
    countOpenPaymentLinks: () => openLinksStmt.get().n,
    countOnlyRoleUsers: (role) => onlyRoleStmt.get(role).n,
  };
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
