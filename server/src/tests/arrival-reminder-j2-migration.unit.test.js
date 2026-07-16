// Content migration: force-sync the `arrival_reminder_1d` row to the registry def when the arrival
// reminder moved J-1 → J-2 (specs/j1-arrival-reminder-email.md). Adrien asked to OVERWRITE the row
// even if personalised, so name/subject/body/dayOffset are forced; sendMode/enabled are preserved.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runArrivalReminderJ2Migration } = require('../utils/migrateArrivalReminderJ2');
const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');

const DEF = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'arrival_reminder_1d');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT, subject TEXT,
      body TEXT, subjectEn TEXT, bodyEn TEXT, dayOffset INTEGER, sendMode TEXT, enabled INTEGER, updatedAt TEXT
    );
  `);
  return db;
}

test('forces name/subject/body + EN subject/body + dayOffset to the registry def, even on a personalised row', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, subjectEn, bodyEn, dayOffset, sendMode, enabled)
              VALUES ('arrival_reminder_1d', 'Mon libellé', 'Sujet perso', 'Corps perso « demain »', 'EN perso', 'EN body perso', -1, 'auto', 0)`).run();

  const res = runArrivalReminderJ2Migration(db);
  assert.equal(res.action, 'updated');

  const row = db.prepare("SELECT * FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get();
  assert.equal(row.name, DEF.name);
  assert.equal(row.subject, DEF.subject);
  assert.equal(row.body, DEF.body);
  // specs/j2-email-coffee-and-sas-complement.md — EN side is force-synced too (the coffee line must reach it).
  assert.equal(row.subjectEn, DEF.subjectEn);
  assert.equal(row.bodyEn, DEF.bodyEn);
  assert.equal(row.dayOffset, -2);
  // sendMode + enabled are the operator's choice → preserved.
  assert.equal(row.sendMode, 'auto');
  assert.equal(row.enabled, 0);
});

test('EN columns absent (pre-bilingual schema) → still force-syncs the FR side, no crash', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT, subject TEXT,
    body TEXT, dayOffset INTEGER, sendMode TEXT, enabled INTEGER, updatedAt TEXT )`);
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled)
              VALUES ('arrival_reminder_1d', 'X', 'Y', 'Z', -1, 'manual', 1)`).run();
  const res = runArrivalReminderJ2Migration(db);
  assert.equal(res.action, 'updated');
  const row = db.prepare("SELECT * FROM email_templates WHERE stableKey='arrival_reminder_1d'").get();
  assert.equal(row.body, DEF.body);
  assert.equal(row.dayOffset, -2);
});

test('is idempotent: a second run leaves the row identical', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled)
              VALUES ('arrival_reminder_1d', 'X', 'Y', 'Z', -1, 'manual', 1)`).run();
  runArrivalReminderJ2Migration(db);
  const after1 = db.prepare("SELECT * FROM email_templates WHERE stableKey='arrival_reminder_1d'").get();
  runArrivalReminderJ2Migration(db);
  const after2 = db.prepare("SELECT * FROM email_templates WHERE stableKey='arrival_reminder_1d'").get();
  assert.deepEqual(after1, after2);
});

test('does not touch other templates', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled)
              VALUES ('arrival_reminder_7d', 'J7', 'S7', 'B7', -7, 'manual', 1)`).run();
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled)
              VALUES ('arrival_reminder_1d', 'J1', 'S1', 'B1', -1, 'manual', 1)`).run();
  runArrivalReminderJ2Migration(db);
  const j7 = db.prepare("SELECT * FROM email_templates WHERE stableKey='arrival_reminder_7d'").get();
  assert.equal(j7.body, 'B7');
  assert.equal(j7.dayOffset, -7);
});

test('returns not_found when the row is absent (no insert side-effect)', () => {
  const db = freshDb();
  const res = runArrivalReminderJ2Migration(db);
  assert.equal(res.action, 'not_found');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM email_templates').get().c, 0);
});

test('skips gracefully on a schema without stableKey', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, body TEXT)');
  const res = runArrivalReminderJ2Migration(db);
  assert.equal(res.action, 'skipped-schema');
});
