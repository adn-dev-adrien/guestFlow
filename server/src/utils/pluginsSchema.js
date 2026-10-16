/**
 * Schema and first seed of the `plugins` table (specs/plugins-phase-0-foundation.md §5, rules 10–12).
 *
 * No row = the plugin is available (not installed). A database that already holds a property or a
 * reservation when the seed runs is an existing install: it gets the twelve built-ins installed and
 * active, so nothing disappears after the update. A fresh database gets none. The seed is recorded in
 * the `migrations` ledger and never runs twice, so an operator who later uninstalls everything is not
 * re-seeded at the next boot.
 */

const { PLUGIN_IDS } = require('../constants/plugins');

const SEED_MIGRATION = 'plugins_builtin_seed_v1';
const SETTINGS_COPY_MIGRATION = 'plugin_settings_from_app_settings_v1';

// specs/plugins-phase-1-sdk.md §5 — the app_settings columns a moved plugin now reads from
// plugin_settings. Encrypted blobs are copied byte for byte: same key, same format.
const SETTINGS_COPY = [
  ['meteoFranceApiKeyEncrypted', 'weather-alerts', 'apiKey'],
  ['googleCalendarId', 'google-calendar', 'calendarId'],
  ['googleOAuthRefreshTokenEncrypted', 'google-calendar', 'refreshToken'],
  ['googleOAuthConnectedEmail', 'google-calendar', 'connectedEmail'],
  ['googleOAuthConnectedAt', 'google-calendar', 'connectedAt'],
  ['googleCalendarSummary', 'google-calendar', 'calendarSummary'],
  ['googleLastSyncAt', 'google-calendar', 'lastSyncAt'],
  ['googleLastSyncOk', 'google-calendar', 'lastSyncOk'],
  ['googleLastSyncDetail', 'google-calendar', 'lastSyncDetail'],
];

function ensurePluginsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id           TEXT PRIMARY KEY,
      enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      source       TEXT NOT NULL DEFAULT 'builtin',
      version      TEXT,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedBuiltinPlugins(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SEED_MIGRATION)) return false;
  const existing = db.prepare('SELECT 1 FROM properties LIMIT 1').get()
    || db.prepare('SELECT 1 FROM reservations LIMIT 1').get();
  const insert = db.prepare("INSERT OR IGNORE INTO plugins (id, enabled, source) VALUES (?, 1, 'builtin')");
  db.transaction(() => {
    if (existing) PLUGIN_IDS.forEach((id) => insert.run(id));
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(SEED_MIGRATION);
  })();
  return Boolean(existing);
}

function ensurePluginSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id  TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, key)
    );
  `);
}

// Runs once. The old columns stay in app_settings, unread, so a rollback to v3.5 finds its data; what
// they hold at the copy is remembered, so `resyncAfterRollback` can tell a value a rollback wrote.
function copyAppSettingsToPlugins(db) {
  ensureLegacySeenTable(db);
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SETTINGS_COPY_MIGRATION)) return 0;
  const cols = new Set(db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name));
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() || {};
  const insert = db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)');
  let copied = 0;
  db.transaction(() => {
    SETTINGS_COPY.forEach(([col, pluginId, key]) => {
      if (!cols.has(col)) return;
      remember(db, col, row[col]);
      const value = row[col];
      if (value === null || value === undefined || value === '') return;
      copied += insert.run(pluginId, key, String(value)).changes;
    });
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(SETTINGS_COPY_MIGRATION);
  })();
  return copied;
}

function ensureLegacySeenTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS legacy_settings_seen (col TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

const asText = (v) => (v === null || v === undefined ? '' : String(v));

function remember(db, col, value) {
  db.prepare('INSERT INTO legacy_settings_seen (col, value) VALUES (?, ?) ON CONFLICT (col) DO UPDATE SET value = excluded.value').run(col, asText(value));
}

// A rollback to a version before the plugins (v3.5) writes the old columns again — a new Google token
// after reconnecting, say. At every boot, a column that changed since it was last seen is carried
// into plugin_settings, so coming back forward keeps the newer value. An unchanged column is never
// copied, so a plugin's own erasure stays erased.
function resyncAfterRollback(db) {
  ensureLegacySeenTable(db);
  if (!db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SETTINGS_COPY_MIGRATION)) return 0;
  const cols = new Set(db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name));
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() || {};
  const seenStmt = db.prepare('SELECT value FROM legacy_settings_seen WHERE col = ?');
  const upsert = db.prepare(`INSERT INTO plugin_settings (plugin_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  const drop = db.prepare('DELETE FROM plugin_settings WHERE plugin_id = ? AND key = ?');
  let carried = 0;
  db.transaction(() => {
    SETTINGS_COPY.forEach(([col, pluginId, key]) => {
      if (!cols.has(col)) return;
      const current = asText(row[col]);
      const seen = seenStmt.get(col);
      if (seen && seen.value === current) return;
      remember(db, col, current);
      // A database copied before this check existed has no memory yet: it starts from today.
      if (!seen) return;
      if (current === '') drop.run(pluginId, key);
      else upsert.run(pluginId, key, current);
      carried += 1;
    });
  })();
  return carried;
}

module.exports = {
  ensurePluginsTable,
  seedBuiltinPlugins,
  ensurePluginSettingsTable,
  copyAppSettingsToPlugins,
  resyncAfterRollback,
  SEED_MIGRATION,
  SETTINGS_COPY_MIGRATION,
  SETTINGS_COPY,
};
