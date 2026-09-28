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

// Runs once. The old columns stay in app_settings, unread, so a rollback to v3.5 finds its data.
function copyAppSettingsToPlugins(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SETTINGS_COPY_MIGRATION)) return 0;
  const cols = new Set(db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name));
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() || {};
  const insert = db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)');
  let copied = 0;
  db.transaction(() => {
    SETTINGS_COPY.forEach(([col, pluginId, key]) => {
      if (!cols.has(col)) return;
      const value = row[col];
      if (value === null || value === undefined || value === '') return;
      copied += insert.run(pluginId, key, String(value)).changes;
    });
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(SETTINGS_COPY_MIGRATION);
  })();
  return copied;
}

module.exports = {
  ensurePluginsTable,
  seedBuiltinPlugins,
  ensurePluginSettingsTable,
  copyAppSettingsToPlugins,
  SEED_MIGRATION,
  SETTINGS_COPY_MIGRATION,
  SETTINGS_COPY,
};
