/**
 * Settings rationalization — specs/settings-rationalization.md.
 * One file for the whole spec: dropped settings, derived settings, moved settings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const schoolHolidaysModel = require('../models/schoolHolidaysModel');
const { shapeResponse } = require('../utils/settingsResponse');
const { __test: { SMTP_FIELDS } } = require('../controllers/settingsController');
const { smtpPortForSecure } = require('../utils/settingsValidation');
const {
  DEAD_SETTINGS_COLUMNS,
  runSettingsRationalizationMigration,
} = require('../utils/settingsRationalizationMigration');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function baselineDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  return db;
}

function settingsColumns(db) {
  return db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
}

// A pre-rationalization install: the baseline plus every dead column and the stray table.
function legacyDb() {
  const db = baselineDb();
  for (const column of DEAD_SETTINGS_COLUMNS) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN ${column} TEXT DEFAULT ''`);
  }
  db.exec('CREATE TABLE payment_methods (id INTEGER PRIMARY KEY, label TEXT)');
  db.exec("INSERT INTO payment_methods (label) VALUES ('Carte')");
  return db;
}

// ---------- rules 9-10 — dead settings are dropped ----------

test('rules 9-10: a fresh install never creates the dead columns', () => {
  const columns = settingsColumns(baselineDb());
  for (const column of DEAD_SETTINGS_COLUMNS) {
    assert.equal(columns.includes(column), false, `${column} is not in schema.sql any more`);
  }
});

test('rules 9-10: the migration drops every dead column and the stray payment_methods table', () => {
  const db = legacyDb();
  db.prepare("UPDATE app_settings SET companyName = 'Domaine Solio' WHERE id = 1").run();

  const { dropped } = runSettingsRationalizationMigration(db);

  assert.deepEqual([...dropped].sort(), [...DEAD_SETTINGS_COLUMNS].sort());
  const columns = settingsColumns(db);
  for (const column of DEAD_SETTINGS_COLUMNS) assert.equal(columns.includes(column), false);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_methods'").get();
  assert.equal(table, undefined);
  assert.equal(db.prepare('SELECT companyName FROM app_settings WHERE id = 1').get().companyName, 'Domaine Solio',
    'the live settings survive the drop');
});

test('rules 9-10: the migration is idempotent', () => {
  const db = legacyDb();
  runSettingsRationalizationMigration(db);
  assert.deepEqual(runSettingsRationalizationMigration(db).dropped, []);
  assert.deepEqual(runSettingsRationalizationMigration(baselineDb()).dropped, []);
});

test('rule 9: the settings model no longer exposes the payment timings', () => {
  const model = settingsModel.create(baselineDb());
  assert.equal(typeof model.paymentTimings, 'undefined');
});

// ---------- rule 11 — the SMTP port is derived, never stored ----------

test('rule 11: implicit TLS means 465, STARTTLS means 587', () => {
  assert.equal(smtpPortForSecure(true), 465);
  assert.equal(smtpPortForSecure(1), 465);
  assert.equal(smtpPortForSecure('1'), 465);
  assert.equal(smtpPortForSecure(false), 587);
  assert.equal(smtpPortForSecure(0), 587);
  assert.equal(smtpPortForSecure(undefined), 587);
});

test('rule 11: the email service gets the port of the security mode', () => {
  const model = settingsModel.create(baselineDb());
  model.upsert({ smtpHost: 'smtp.example.com', smtpSecure: 1 });
  assert.equal(model.decryptedSmtpSettings().port, 465);
  model.upsert({ smtpSecure: 0 });
  assert.equal(model.decryptedSmtpSettings().port, 587);
});

test('rule 11: the SMTP field map has no port entry, so a sent port cannot be stored', () => {
  assert.equal(SMTP_FIELDS.some((f) => f.input === 'port'), false);
  assert.equal(SMTP_FIELDS.some((f) => f.column === 'smtpPort'), false);
});

// ---------- rule 13 — the school-holiday sync cadence is fixed ----------

test('rule 13: the sync cadence is 60 days / 24 months whatever the legacy columns hold', () => {
  const db = baselineDb();
  db.prepare('INSERT OR IGNORE INTO school_holidays_sync_state (id) VALUES (1)').run();
  db.prepare('UPDATE school_holidays_sync_state SET syncIntervalDays = 7, syncHorizonMonths = 3 WHERE id = 1').run();
  const state = schoolHolidaysModel.create(db).getSyncState();
  assert.equal(state.syncIntervalDays, 60);
  assert.equal(state.syncHorizonMonths, 24);
  assert.equal(schoolHolidaysModel.SYNC_INTERVAL_DAYS, 60);
  assert.equal(schoolHolidaysModel.SYNC_HORIZON_MONTHS, 24);
});

// ---------- bug 2 — the English devis footer round-trips ----------

test('bug 2: GET /settings returns the English devis footer', () => {
  const shaped = shapeResponse({ quoteFooterText: 'Merci', quoteFooterTextEn: 'Thank you' });
  assert.equal(shaped.quote.footerText, 'Merci');
  assert.equal(shaped.quote.footerTextEn, 'Thank you');
});
