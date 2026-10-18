/**
 * What the console knows of the instances it runs (specs/hosting-h1-fleet-runtime.md §5): the
 * `instances` row of each customer, the fleet updates and their items, the weekly restore checks,
 * the platform's email counters, the redirects of renamed addresses and the host alerts.
 */

const FIELDS = ['port', 'version', 'previous_version', 'unit_state', 'last_backup_at', 'last_backup_verified_at',
  'disk_bytes', 'disk_measured_at', 'cert_expires_at', 'memory_bytes', 'memory_max_bytes', 'down_since', 'probed_at'];

function buildHostingModel(db) {
  const getStmt = db.prepare('SELECT * FROM instances WHERE customer_id = ?');
  const listStmt = db.prepare('SELECT * FROM instances');
  const ensureStmt = db.prepare('INSERT OR IGNORE INTO instances (customer_id) VALUES (?)');
  const portsStmt = db.prepare('SELECT port FROM instances WHERE port IS NOT NULL');
  const deleteStmt = db.prepare('DELETE FROM instances WHERE customer_id = ?');

  const insertUpdateStmt = db.prepare(`INSERT INTO fleet_updates (kind, plugin_id, target_version, scope, state, started_at, operator)
    VALUES (@kind, @pluginId, @targetVersion, @scope, 'running', @startedAt, @operator)`);
  const insertItemStmt = db.prepare(`INSERT INTO fleet_update_items (update_id, customer_id, position, from_version, state)
    VALUES (?, ?, ?, ?, 'pending')`);
  const setItemStmt = db.prepare(`UPDATE fleet_update_items SET state = @state, phase = @phase, detail = @detail,
    snapshot = COALESCE(@snapshot, snapshot) WHERE update_id = @updateId AND customer_id = @customerId`);
  const endUpdateStmt = db.prepare('UPDATE fleet_updates SET state = ?, ended_at = ?, error = ? WHERE id = ?');
  const getUpdateStmt = db.prepare('SELECT * FROM fleet_updates WHERE id = ?');
  const itemsStmt = db.prepare('SELECT * FROM fleet_update_items WHERE update_id = ? ORDER BY position');
  const runningUpdateStmt = db.prepare("SELECT * FROM fleet_updates WHERE state = 'running' ORDER BY id DESC LIMIT 1");
  const recentUpdatesStmt = db.prepare('SELECT * FROM fleet_updates ORDER BY id DESC LIMIT ?');
  const rolledBackTargetsStmt = db.prepare(`SELECT DISTINCT u.target_version AS version FROM fleet_updates u
    JOIN fleet_update_items i ON i.update_id = u.id WHERE u.kind = 'release' AND i.state = 'rolled_back'`);
  const rolledBackPluginTargetsStmt = db.prepare(`SELECT DISTINCT u.plugin_id AS id, u.target_version AS version FROM fleet_updates u
    JOIN fleet_update_items i ON i.update_id = u.id WHERE u.kind = 'plugin' AND i.state = 'rolled_back'`);
  const skipRestStmt = db.prepare("UPDATE fleet_update_items SET state = 'skipped', detail = ? WHERE update_id = ? AND state = 'pending'");

  const insertCheckStmt = db.prepare('INSERT INTO backup_checks (customer_id, at, ok, reservations, detail) VALUES (?, ?, ?, ?, ?)');
  const lastCheckStmt = db.prepare('SELECT * FROM backup_checks WHERE customer_id = ? ORDER BY id DESC LIMIT 1');
  const upsertCounterStmt = db.prepare(`INSERT INTO mail_counters (instance, day, count) VALUES (?, ?, ?)
    ON CONFLICT (instance, day) DO UPDATE SET count = excluded.count`);
  const counterStmt = db.prepare('SELECT count FROM mail_counters WHERE instance = ? AND day = ?');

  const addRedirectStmt = db.prepare(`INSERT INTO host_redirects (slug, customer_id, until) VALUES (?, ?, ?)
    ON CONFLICT (slug) DO UPDATE SET customer_id = excluded.customer_id, until = excluded.until`);
  const expiredRedirectsStmt = db.prepare('SELECT * FROM host_redirects WHERE until < ?');
  const redirectsOfStmt = db.prepare('SELECT * FROM host_redirects WHERE customer_id = ?');
  const dropRedirectStmt = db.prepare('DELETE FROM host_redirects WHERE slug = ?');
  const getAlertStmt = db.prepare('SELECT * FROM host_alerts WHERE key = ?');
  const openAlertStmt = db.prepare(`INSERT INTO host_alerts (key, customer_id, kind, severity, text, opened_at, last_sent_at, closed_at)
    VALUES (@key, @customerId, @kind, @severity, @text, @at, NULL, NULL)
    ON CONFLICT (key) DO UPDATE SET text = excluded.text, severity = excluded.severity,
      opened_at = CASE WHEN host_alerts.closed_at IS NULL THEN host_alerts.opened_at ELSE excluded.opened_at END,
      last_sent_at = CASE WHEN host_alerts.closed_at IS NULL THEN host_alerts.last_sent_at ELSE NULL END,
      closed_at = NULL`);
  const sentAlertStmt = db.prepare('UPDATE host_alerts SET last_sent_at = ? WHERE key = ?');
  const closeAlertStmt = db.prepare('UPDATE host_alerts SET closed_at = ? WHERE key = ? AND closed_at IS NULL');
  const openAlertsStmt = db.prepare('SELECT * FROM host_alerts WHERE closed_at IS NULL ORDER BY opened_at');

  return {
    get: (customerId) => getStmt.get(Number(customerId)) || null,
    list: () => listStmt.all(),
    ensure(customerId) {
      ensureStmt.run(Number(customerId));
      return getStmt.get(Number(customerId));
    },
    set(customerId, fields) {
      const keys = Object.keys(fields).filter((k) => FIELDS.includes(k));
      if (!keys.length) return;
      ensureStmt.run(Number(customerId));
      db.prepare(`UPDATE instances SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE customer_id = @customerId`)
        .run({ ...Object.fromEntries(keys.map((k) => [k, fields[k] === undefined ? null : fields[k]])), customerId: Number(customerId) });
    },
    usedPorts: () => new Set(portsStmt.all().map((r) => r.port)),
    remove: (customerId) => deleteStmt.run(Number(customerId)),

    createUpdate({ kind = 'release', pluginId = null, targetVersion, scope, startedAt, operator, items }) {
      return db.transaction(() => {
        const id = Number(insertUpdateStmt.run({ kind, pluginId, targetVersion, scope, startedAt, operator }).lastInsertRowid);
        items.forEach((it, i) => insertItemStmt.run(id, it.customerId, i, it.fromVersion));
        return id;
      })();
    },
    setItem: (updateId, customerId, { state, phase = null, detail = '', snapshot = null }) => setItemStmt.run({ updateId, customerId, state, phase, detail, snapshot }),
    skipRest: (updateId, detail) => skipRestStmt.run(detail, updateId),
    endUpdate: (id, state, at, error = null) => endUpdateStmt.run(state, at, error, id),
    getUpdate: (id) => getUpdateStmt.get(id) || null,
    items: (id) => itemsStmt.all(id),
    runningUpdate: () => runningUpdateStmt.get() || null,
    recentUpdates: (limit = 10) => recentUpdatesStmt.all(limit),
    // The releases an update had to roll back somewhere (H1 rule 28).
    rolledBackTargets: () => new Set(rolledBackTargetsStmt.all().map((r) => r.version)),
    // The plugin versions a push had to roll back somewhere, as `id@version` (H1 rule 11).
    rolledBackPluginTargets: () => new Set(rolledBackPluginTargetsStmt.all().map((r) => `${r.id}@${r.version}`)),

    addCheck: ({ customerId, at, ok, reservations = null, detail = '' }) => insertCheckStmt.run(customerId, at, ok ? 1 : 0, reservations, detail),
    lastCheck: (customerId) => lastCheckStmt.get(customerId) || null,

    setMailCount: (customerId, day, count) => upsertCounterStmt.run(customerId, day, count),
    mailCount: (customerId, day) => (counterStmt.get(customerId, day) || { count: 0 }).count,

    addRedirect: (slug, customerId, until) => addRedirectStmt.run(slug, customerId, until),
    expiredRedirects: (day) => expiredRedirectsStmt.all(day),
    redirectsOf: (customerId) => redirectsOfStmt.all(customerId),
    dropRedirect: (slug) => dropRedirectStmt.run(slug),

    getAlert: (key) => getAlertStmt.get(key) || null,
    openAlert: ({ key, customerId = null, kind, severity, text, at }) => openAlertStmt.run({ key, customerId, kind, severity, text, at }),
    markAlertSent: (key, at) => sentAlertStmt.run(at, key),
    closeAlert: (key, at) => closeAlertStmt.run(at, key),
    openAlerts: () => openAlertsStmt.all(),
  };
}

module.exports = { buildHostingModel };
