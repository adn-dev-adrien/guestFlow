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
 *   list()                  → [{ id, enabled, source, version, manifest, pinnedSha256, previousVersion,
 *                              previousSource, previousSha256, rollbackUntil, installedAt, updatedAt }]
 *   get(id)                 → row | null
 *   install(id, pkg?)       → inserts an active row; `pkg` = { version, source, manifest, sha256 }
 *                             (specs/plugins-phase-4-registry.md rule 11), `bundled` when omitted
 *   switchVersion(id, pkg, { rollbackUntil }) → records an update: the running package becomes the
 *                             previous one, kept for `rollbackUntil` (rule 16)
 *   rollBack(id)            → the previous package becomes the running one, and no rollback is left
 *   expireRollback(id)      → forgets the previous package (its window is over)
 *   syncBundled(id, manifest, sha256) → a `bundled` row follows the copy the running release ships
 *   markHooksPending(id, kind) / hooksPendingKind(id) / pendingHooks() / clearHooksPending(id) → an install that needed a restart owes its hooks
 *   setEnabled(id, enabled) → flips the flag (and forgets a system switch-off)
 *   switchOff(id, reason)   → off, with the id of the off requirement that caused it (`offReason`)
 *   uninstall(id)           → deletes the row (the plugin's data is kept, rule 6)
 *   isActive(id)            → boolean
 *   listActiveIds()         → [id]
 *   countOpenPaymentLinks() / countPendingDeactivations() / countOnlyRoleUsers(role) → blocker counts (rule 8)
 */

function buildModel(database) {
  const COLUMNS = `id, enabled, source, version, manifest, pinned_sha256 AS pinnedSha256,
    previous_version AS previousVersion, previous_source AS previousSource, previous_sha256 AS previousSha256,
    rollback_until AS rollbackUntil, off_reason AS offReason, installed_at AS installedAt, updated_at AS updatedAt`;
  const listStmt = database.prepare(`SELECT ${COLUMNS} FROM plugins ORDER BY id`);
  const getStmt = database.prepare(`SELECT ${COLUMNS} FROM plugins WHERE id = ?`);
  const insertStmt = database.prepare(`INSERT INTO plugins (id, enabled, source, version, manifest, pinned_sha256)
    VALUES (@id, 1, @source, @version, @manifest, @sha256)`);
  const switchStmt = database.prepare(`UPDATE plugins SET
      previous_version = version, previous_source = source, previous_sha256 = pinned_sha256,
      version = @version, source = @source, manifest = @manifest, pinned_sha256 = @sha256,
      rollback_until = @rollbackUntil, updated_at = datetime('now')
    WHERE id = @id`);
  const rollBackStmt = database.prepare(`UPDATE plugins SET
      version = previous_version, source = previous_source, pinned_sha256 = previous_sha256, manifest = @manifest,
      previous_version = NULL, previous_source = NULL, previous_sha256 = NULL, rollback_until = NULL,
      updated_at = datetime('now')
    WHERE id = @id AND previous_version IS NOT NULL`);
  const expireStmt = database.prepare(`UPDATE plugins SET previous_version = NULL, previous_source = NULL,
      previous_sha256 = NULL, rollback_until = NULL WHERE id = ?`);
  const syncBundledStmt = database.prepare(`UPDATE plugins SET version = @version, manifest = @manifest, pinned_sha256 = @sha256
    WHERE id = @id AND source = 'bundled'
      AND (version IS NOT @version OR manifest IS NOT @manifest OR pinned_sha256 IS NOT @sha256)`);
  const setEnabledStmt = database.prepare("UPDATE plugins SET enabled = ?, off_reason = NULL, updated_at = datetime('now') WHERE id = ?");
  const switchOffStmt = database.prepare("UPDATE plugins SET enabled = 0, off_reason = ?, updated_at = datetime('now') WHERE id = ?");
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

  const parseManifest = (text) => {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  };
  const toRow = (row) => (row ? { ...row, enabled: row.enabled === 1, manifest: parseManifest(row.manifest) } : null);
  const pkgParams = (id, pkg = {}) => ({
    id,
    source: pkg.source || 'bundled',
    version: pkg.version || null,
    manifest: pkg.manifest ? JSON.stringify(pkg.manifest) : null,
    sha256: pkg.sha256 || null,
  });

  return {
    transaction: (fn) => database.transaction(fn)(),
    list: () => listStmt.all().map(toRow),
    get: (id) => toRow(getStmt.get(id)),
    install(id, pkg) { insertStmt.run(pkgParams(id, pkg)); },
    switchVersion(id, pkg, { rollbackUntil = null } = {}) { switchStmt.run({ ...pkgParams(id, pkg), rollbackUntil }); },
    rollBack(id, manifest) { return rollBackStmt.run({ id, manifest: manifest ? JSON.stringify(manifest) : null }).changes > 0; },
    expireRollback(id) { expireStmt.run(id); },
    syncBundled(id, manifest, sha256 = null) {
      return syncBundledStmt.run({ id, version: manifest.version, manifest: JSON.stringify(manifest), sha256 }).changes > 0;
    },
    // 1 = install and activation hooks owed (the value #844 wrote), 2 = activation hooks only (a plugin switched on, not installed).
    markHooksPending(id, kind = 'install') {
      database.prepare('UPDATE plugins SET hooks_pending = CASE WHEN hooks_pending = 1 THEN 1 ELSE ? END WHERE id = ?').run(kind === 'activate' ? 2 : 1, id);
    },
    hooksPendingKind(id) {
      const r = database.prepare('SELECT hooks_pending AS p FROM plugins WHERE id = ?').get(id);
      return !r || !r.p ? null : (r.p === 1 ? 'install' : 'activate');
    },
    pendingHooks: () => database.prepare('SELECT id FROM plugins WHERE hooks_pending > 0 ORDER BY id').all().map((r) => r.id),
    clearHooksPending(id) { database.prepare('UPDATE plugins SET hooks_pending = 0 WHERE id = ?').run(id); },
    setEnabled(id, enabled) { setEnabledStmt.run(enabled ? 1 : 0, id); },
    // Rule 57 — switched off by the system because the requirement `reason` is off; any later switch clears the notice.
    switchOff(id, reason) { switchOffStmt.run(reason, id); },
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
