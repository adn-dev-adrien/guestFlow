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
const { DEFAULT_WEEKDAY, BEGINNING_OF_TIME } = require('./laundrySchedule');

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

// specs/laundry-bath-mat.md rule 13 — the manual line counts bath mats too. Existing rows read 0.
function addManualBathMats(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(laundry_trip_manual_additions)').all().map((c) => c.name));
  if (!columns.has('bathMats')) db.exec('ALTER TABLE laundry_trip_manual_additions ADD COLUMN bathMats INTEGER NOT NULL DEFAULT 0');
}

// specs/linen-laundry-days.md rules 4-5 and §5 — the single `laundryWeekday` becomes the first version of
// a dated schedule, effective from the beginning of time and with a one-day turnaround: with one
// weekday every batch waits 7 days, so every figure of an existing install stays what it was. The
// frozen setting stays in plugin_settings for a rollback to 1.1.x. Seeded only while the table is empty.
function createLaundryScheduleVersions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS laundry_schedule_versions (
      effectiveFrom  TEXT PRIMARY KEY NOT NULL CHECK (length(effectiveFrom) = 10),
      weekdays       TEXT NOT NULL,
      turnaroundDays INTEGER NOT NULL DEFAULT 1 CHECK (turnaroundDays BETWEEN 1 AND 14),
      createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  if (db.prepare('SELECT 1 FROM laundry_schedule_versions LIMIT 1').get()) return;
  const stored = db.prepare("SELECT value FROM plugin_settings WHERE plugin_id = 'linen' AND key = 'laundryWeekday'").get();
  const raw = stored ? String(stored.value).trim() : '';
  const weekday = raw !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 6
    ? Number(raw)
    : DEFAULT_WEEKDAY;
  db.prepare('INSERT INTO laundry_schedule_versions (effectiveFrom, weekdays, turnaroundDays) VALUES (?, ?, 1)')
    .run(BEGINNING_OF_TIME, String(weekday));
}

const MIGRATIONS = Object.freeze([
  { name: 'laundry_tables_v1', up: createTables },
  { name: 'settings_from_app_settings_v1', up: copySettingsFromAppSettings },
  { name: 'manual_additions_bath_mats_v1', up: addManualBathMats },
  { name: 'laundry_schedule_v1', up: createLaundryScheduleVersions },
]);

module.exports = { MIGRATIONS, SETTINGS_COPY_MARKER };
