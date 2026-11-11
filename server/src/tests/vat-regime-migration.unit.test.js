// specs/vat-optional-mode.md rules 21 and 22 — the migration: period 1 seeded from the current rate,
// every row pointing at it, the trigger created, all of it idempotent, and the settings column kept as a
// mirror of the rate in force. Tables are the minimal ones the migration needs.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runVatRegimeMigration } = require('../utils/vatRegimeMigration');
const vatRegimeModel = require('../models/vatRegimeModel');

function legacyDb({ vatRate = 10, rows = 3 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      startDate TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, ?)').run(vatRate);
  for (let i = 0; i < rows; i += 1) db.prepare("INSERT INTO reservations (startDate) VALUES ('2027-01-05')").run();
  return db;
}

test('rule 22: period 1 is seeded from the rate the install runs on', () => {
  const db = legacyDb({ vatRate: 7 });
  runVatRegimeMigration(db);
  const periods = db.prepare('SELECT regime, rate, legalMention, basis, effectiveFrom, note FROM vat_periods').all();
  assert.deepEqual(periods, [{ regime: 'subject', rate: 7, legalMention: null, basis: 'all', effectiveFrom: null, note: 'initial' }]);
});

test('rule 22: every existing reservation points at period 1 and no price column is written', () => {
  const db = legacyDb({ rows: 4 });
  runVatRegimeMigration(db);
  assert.deepEqual(db.prepare('SELECT DISTINCT vatPeriodId FROM reservations').all(), [{ vatPeriodId: 1 }]);
  const columns = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'kind', 'startDate', 'createdAt', 'vatPeriodId']);
});

test('rule 22: the migration is idempotent', () => {
  const db = legacyDb();
  runVatRegimeMigration(db);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom) VALUES ('not_subject', 0, 'art_293_b', 'booking', '2027-06-01')").run();
  db.prepare('UPDATE reservations SET vatPeriodId = 2 WHERE id = 1').run();
  runVatRegimeMigration(db);
  runVatRegimeMigration(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vat_periods').get().n, 2);
  assert.equal(db.prepare('SELECT vatPeriodId FROM reservations WHERE id = 1').get().vatPeriodId, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n, 1);
});

test('rule 22: an orphan row of a database that already has periods is assigned by the same predicate', () => {
  const db = legacyDb({ rows: 0 });
  runVatRegimeMigration(db);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom) VALUES ('not_subject', 0, 'art_293_b', 'arrival', '2027-06-01')").run();
  db.exec("DROP TRIGGER trg_reservations_vat_period");
  db.prepare("INSERT INTO reservations (startDate) VALUES ('2027-07-01'), ('2027-05-01')").run();
  runVatRegimeMigration(db);
  assert.deepEqual(db.prepare('SELECT id, vatPeriodId FROM reservations ORDER BY id').all(), [{ id: 1, vatPeriodId: 2 }, { id: 2, vatPeriodId: 1 }]);
});

test('rule 22: app_settings.vatRate stays, as a mirror of the rate in force (0 when not subject)', () => {
  const db = legacyDb({ vatRate: 10 });
  runVatRegimeMigration(db);
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 10);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_261_d_4', 'all')").run();
  vatRegimeModel.syncMirror(db);
  assert.equal(db.prepare('SELECT vatRate FROM app_settings').get().vatRate, 0);
});

test('rule 21: a fresh install runs on one period, subject, 10 %, for every reservation', () => {
  const db = legacyDb({ rows: 0 });
  runVatRegimeMigration(db);
  assert.deepEqual(vatRegimeModel.forRow(db, null), {
    periodId: 1, regime: 'subject', rate: 10, legalMention: null, legalMentionText: null, legalMentionTextEn: null,
  });
  db.prepare("INSERT INTO reservations (startDate) VALUES ('2030-01-01')").run();
  assert.equal(db.prepare('SELECT vatPeriodId FROM reservations').get().vatPeriodId, 1);
});

test('rule 3: the table refuses the states the model never writes', () => {
  const db = legacyDb({ rows: 0 });
  runVatRegimeMigration(db);
  const insert = (sql) => () => db.exec(`INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom) VALUES ${sql}`);
  assert.throws(insert("('not_subject', 5, 'art_293_b', 'all', NULL)"), /CHECK/);
  assert.throws(insert("('not_subject', 0, NULL, 'all', NULL)"), /CHECK/);
  assert.throws(insert("('subject', 10, 'art_293_b', 'all', NULL)"), /CHECK/);
  assert.throws(insert("('subject', 10, NULL, 'booking', NULL)"), /CHECK/);
  assert.throws(insert("('subject', 10, NULL, 'all', '2027-01-01')"), /CHECK/);
  assert.throws(insert("('subject', 120, NULL, 'all', NULL)"), /CHECK/);
});
