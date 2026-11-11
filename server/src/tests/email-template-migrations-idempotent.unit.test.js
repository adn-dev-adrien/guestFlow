// The force-sync migrations of email templates write a row only when a column actually differs: a re-run
// leaves `updatedAt` alone (it used to move at every boot, like the reservation-number recap fixed in #839).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDepositReminderAnchorMigration } = require('../utils/migrateDepositReminderAnchor');
const { runGuestEmailSequenceMigration } = require('../utils/migrateGuestEmailSequence');
const { freshDb } = require('./guestEmailSequenceFixtures');

const SENTINEL = '2000-01-01 00:00:00';

test('deposit reminder anchor: the first run rewrites a stale row, a second run leaves it untouched', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT, subject TEXT, body TEXT,
    subjectEn TEXT, bodyEn TEXT, anchor TEXT, dayOffset INTEGER, sendMode TEXT, enabled INTEGER, updatedAt TEXT)`);
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, anchor, dayOffset, sendMode, enabled, updatedAt)
              VALUES ('deposit_reminder', 'X', 'Y', 'Z', 'start', -1, 'auto', 1, ?)`).run(SENTINEL);
  assert.equal(runDepositReminderAnchorMigration(db).action, 'updated');
  assert.notEqual(db.prepare('SELECT updatedAt FROM email_templates').get().updatedAt, SENTINEL);

  db.prepare('UPDATE email_templates SET updatedAt = ?').run(SENTINEL);
  const before = db.prepare('SELECT * FROM email_templates').get();
  assert.equal(runDepositReminderAnchorMigration(db).action, 'unchanged');
  assert.deepEqual(db.prepare('SELECT * FROM email_templates').get(), before);
});

test('guest email sequence: a second run rewrites no template and moves no updatedAt', () => {
  const db = freshDb();
  db.prepare("UPDATE email_templates SET body = 'old copy' WHERE stableKey IN ('reservation_confirmation', 'arrival_reminder_7d', 'arrival_reminder_1d')").run();
  assert.equal(runGuestEmailSequenceMigration(db).templatesSynced, 3);
  db.prepare("UPDATE email_templates SET updatedAt = ? WHERE stableKey IN ('reservation_confirmation', 'arrival_reminder_7d', 'arrival_reminder_1d')").run(SENTINEL);
  assert.equal(runGuestEmailSequenceMigration(db).templatesSynced, 0);
  const stamps = db.prepare("SELECT updatedAt FROM email_templates WHERE stableKey IN ('reservation_confirmation', 'arrival_reminder_7d', 'arrival_reminder_1d')").all();
  assert.deepEqual(stamps.map((r) => r.updatedAt), [SENTINEL, SENTINEL, SENTINEL]);
});
