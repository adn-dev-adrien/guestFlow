/**
 * The `neat` plugin's migrations (specs/plugins-phase-3b-neat.md rules 10, 11, 19).
 *
 * The two Neat tables left the core baseline: on an existing database they are already there and
 * `CREATE TABLE IF NOT EXISTS` keeps every row; on a new one they appear at install.
 *
 * The 13 settings are copied once from their app_settings columns, as stored (the secret's blob
 * included). The erasure empties those columns, so the copy that reruns at the next install finds
 * nothing to bring back.
 */

const { KEYS } = require('./settingsStore');

const ID = 'neat';

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const tableColumns = (db, name) => new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name));

// One subscription job per (reservation, environment): UNIQUE keeps staging-era jobs dead once the
// environment flips to production while letting the scan enqueue a fresh production job.
function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS neat_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER NOT NULL,
      environment TEXT NOT NULL,
      externalId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      neatSubscriptionId TEXT,
      premiumAmount REAL,
      billedAmount REAL,
      attempts INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt TEXT,
      lastError TEXT,
      errorKind TEXT,
      lastNotifiedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (environment IN ('production', 'staging')),
      CHECK (status IN ('pending', 'active', 'failed', 'voided')),
      UNIQUE (reservationId, environment),
      FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_neat_subscriptions_due ON neat_subscriptions (status, nextAttemptAt);
    CREATE TABLE IF NOT EXISTS neat_price_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment TEXT NOT NULL,
      contractId TEXT NOT NULL,
      fieldsHash TEXT NOT NULL,
      premium REAL NOT NULL,
      fetchedAt TEXT NOT NULL,
      UNIQUE (environment, contractId, fieldsHash)
    );
  `);
}

function copySettingsFromAppSettings(db) {
  if (!hasTable(db, 'app_settings') || !hasTable(db, 'plugin_settings')) return;
  const cols = tableColumns(db, 'app_settings');
  const keys = KEYS.filter((key) => cols.has(key));
  if (keys.length === 0) return;
  const row = db.prepare(`SELECT ${keys.join(', ')} FROM app_settings WHERE id = 1`).get();
  if (!row) return;
  const insert = db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)');
  keys.forEach((key) => {
    const value = row[key];
    if (value === null || value === undefined || String(value) === '') return;
    insert.run(ID, key, String(value));
  });
}

// Rule 14 — back to the column defaults, so an erased connection never comes back.
function resetLegacyColumns(db) {
  if (!hasTable(db, 'app_settings')) return;
  const cols = tableColumns(db, 'app_settings');
  const sets = KEYS.filter((key) => cols.has(key)).map((key) => {
    if (key === 'neatEnvironment') return "neatEnvironment = 'staging'";
    if (key === 'neatMarginPercent') return 'neatMarginPercent = NULL';
    return `${key} = ''`;
  });
  if (sets.length > 0) db.prepare(`UPDATE app_settings SET ${sets.join(', ')} WHERE id = 1`).run();
}

const MIGRATIONS = [
  { name: 'tables_v1', up: createTables },
  { name: 'settings_from_app_settings_v1', up: copySettingsFromAppSettings },
];

module.exports = { MIGRATIONS, createTables, copySettingsFromAppSettings, resetLegacyColumns, hasTable };
