/**
 * Plugins model — sole DB access for `plugins` (specs/plugins-phase-0-foundation.md §4.1).
 *
 * States: no row = available; enabled = 1 → active; enabled = 0 → installed but inactive.
 * `isActive` runs on every request of a plugin route and every scheduled pass. It reads the table
 * each time rather than caching: a primary-key lookup costs microseconds, and a write from another
 * process (a maintenance script, the E2E seed) is seen at once.
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
 *   countOpenPaymentLinks() / countPendingDeactivations() / countOnlyRoleUsers(role) → blocker counts (rule 8)
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
  const isActiveStmt = database.prepare('SELECT 1 FROM plugins WHERE id = ? AND enabled = 1');
  const openLinksStmt = database.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open'");
  // A link cancelled here but not yet deactivated at the provider is still payable there; only the
  // plugin's poll retries it (specs/plugins-phase-3a-online-payment.md rule 8).
  // Prepared on first use: a database from before phase 3a has no such column, and nothing pending.
  const countPendingDeactivations = () => {
    try {
      return database.prepare('SELECT COUNT(*) AS n FROM payment_links WHERE remoteCancelPendingAt IS NOT NULL').get().n;
    } catch {
      return 0;
    }
  };
  // Active users holding `role` without admin: a combined admin account keeps every screen, so it
  // never needs the plugin that carries the role.
  const onlyRoleStmt = database.prepare(`
    SELECT COUNT(DISTINCT u.id) AS n FROM users u
    JOIN user_roles r ON r.userId = u.id AND r.role = ?
    WHERE u.isActive = 1
      AND NOT EXISTS (SELECT 1 FROM user_roles a WHERE a.userId = u.id AND a.role = 'admin')
  `);

  const toRow = (row) => (row ? { ...row, enabled: row.enabled === 1 } : null);

  return {
    list: () => listStmt.all().map(toRow),
    get: (id) => toRow(getStmt.get(id)),
    install(id) { insertStmt.run(id); },
    setEnabled(id, enabled) { setEnabledStmt.run(enabled ? 1 : 0, id); },
    uninstall(id) { deleteStmt.run(id); },
    isActive: (id) => Boolean(isActiveStmt.get(id)),
    listActiveIds: () => activeStmt.all().map((r) => r.id),
    countOpenPaymentLinks: () => openLinksStmt.get().n,
    countPendingDeactivations,
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
