/**
 * The `linen` plugin's migrations (specs/plugins-phase-2-hosts.md rules 15, 28-29).
 *
 * The three laundry tables left the core baseline: on an existing database they are already there
 * and `CREATE TABLE IF NOT EXISTS` only records the ledger row; on a new one they appear at install.
 *
 * The eight settings move from app_settings columns to plugin_settings. The copy runs ONCE per
 * database, ever: its marker lives in the core ledger under a name the plugin's erasure does not
 * forget (`plugin:linen:*` is forgotten), so a reinstall after « Effacer aussi ses données » starts
 * from the defaults instead of bringing the frozen column values back. The columns stay in place,
 * unread, for a rollback (phase 1 rule 25).
 */

const { SETTING_KEYS } = require('./settings');

const SETTINGS_COPY_MARKER = 'plugin_settings_copied_from_app_settings:linen';

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS laundry_trip_skips (
      tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS laundry_trip_manual_additions (
      tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
      singleBeds   INTEGER NOT NULL DEFAULT 0,
      doubleBeds   INTEGER NOT NULL DEFAULT 0,
      babyBeds     INTEGER NOT NULL DEFAULT 0,
      largeTowels  INTEGER NOT NULL DEFAULT 0,
      mediumTowels INTEGER NOT NULL DEFAULT 0,
      smallTowels  INTEGER NOT NULL DEFAULT 0,
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS laundry_extra_trips (
      tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
      pickUpAll    INTEGER NOT NULL DEFAULT 1,
      singleBeds   INTEGER NOT NULL DEFAULT 0,
      doubleBeds   INTEGER NOT NULL DEFAULT 0,
      babyBeds     INTEGER NOT NULL DEFAULT 0,
      largeTowels  INTEGER NOT NULL DEFAULT 0,
      mediumTowels INTEGER NOT NULL DEFAULT 0,
      smallTowels  INTEGER NOT NULL DEFAULT 0,
      bathMats     INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function copySettingsFromAppSettings(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(SETTINGS_COPY_MARKER)) return;
  const columns = new Set(db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name));
  const row = columns.size ? db.prepare('SELECT * FROM app_settings ORDER BY id LIMIT 1').get() : null;
  const has = db.prepare("SELECT 1 FROM plugin_settings WHERE plugin_id = 'linen' AND key = ?");
  const insert = db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('linen', ?, ?)");
  if (row) {
    SETTING_KEYS.forEach((key) => {
      if (!columns.has(key) || has.get(key)) return;
      const value = row[key];
      if (value === null || value === undefined || String(value) === '') return;
      insert.run(key, String(value));
    });
  }
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(SETTINGS_COPY_MARKER);
}

const MIGRATIONS = Object.freeze([
  { name: 'laundry_tables_v1', up: createTables },
  { name: 'settings_from_app_settings_v1', up: copySettingsFromAppSettings },
]);

module.exports = { MIGRATIONS, SETTINGS_COPY_MARKER };
