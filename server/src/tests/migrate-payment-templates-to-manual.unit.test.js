// One-shot flip of the seeded dunning templates to manual send
// (specs/payment-schedule-and-cancellation.md §1 amendment, rule 45).
//
// The registry change alone is invisible to an existing install: templates are seeded once, so the
// production rows keep the `sendMode` they were born with. Without this migration the two reminders
// would go on mailing guests at 08:00 after the deploy — precisely what the amendment forbids.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runPaymentTemplatesToManualMigration } = require('../utils/migratePaymentTemplatesToManual');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT NOT NULL,
      subject TEXT NOT NULL, body TEXT NOT NULL, dayOffset INTEGER NOT NULL DEFAULT 0,
      anchor TEXT NOT NULL DEFAULT 'start', sendMode TEXT NOT NULL DEFAULT 'manual',
      enabled INTEGER NOT NULL DEFAULT 1, updatedAt TEXT
    );
  `);
  return db;
}

function seed(db, stableKey, sendMode, enabled = 1) {
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, sendMode, enabled)
              VALUES (?, ?, 'S', 'B', ?, ?)`).run(stableKey, stableKey, sendMode, enabled);
}

const modeOf = (db, key) =>
  db.prepare('SELECT sendMode FROM email_templates WHERE stableKey = ?').get(key).sendMode;

test('the two auto reminders are flipped to manual', () => {
  const db = freshDb();
  seed(db, 'deposit_reminder', 'auto');
  seed(db, 'balance_reminder', 'auto');

  const out = runPaymentTemplatesToManualMigration(db);

  assert.equal(out.action, 'updated');
  assert.equal(out.changed, 2);
  assert.equal(modeOf(db, 'deposit_reminder'), 'manual');
  assert.equal(modeOf(db, 'balance_reminder'), 'manual');
  db.close();
});

test('a stay email keeps its automatic pass — this is about money, not about email', () => {
  const db = freshDb();
  seed(db, 'arrival_reminder_1d', 'auto');
  seed(db, 'balance_reminder', 'auto');

  assert.equal(runPaymentTemplatesToManualMigration(db).changed, 1);
  assert.equal(modeOf(db, 'arrival_reminder_1d'), 'auto');
  db.close();
});

test('a disabled reminder is flipped but stays disabled — enabling it is the operator\'s call', () => {
  const db = freshDb();
  seed(db, 'deposit_reminder', 'auto', 0);

  runPaymentTemplatesToManualMigration(db);

  const row = db.prepare("SELECT sendMode, enabled FROM email_templates WHERE stableKey = 'deposit_reminder'").get();
  assert.deepEqual(row, { sendMode: 'manual', enabled: 0 });
  db.close();
});

test('a second boot changes nothing', () => {
  const db = freshDb();
  seed(db, 'deposit_reminder', 'auto');

  runPaymentTemplatesToManualMigration(db);
  const second = runPaymentTemplatesToManualMigration(db);

  assert.equal(second.action, 'already-manual');
  assert.equal(second.changed, 0);
  db.close();
});

test('the function itself is unconditional — the `migrations` table is what makes it one-shot', () => {
  // Documents where the "never clobber the operator twice" guarantee actually lives: NOT here. Called
  // again, this function would flip an `auto` row back to `manual`; database.js only ever calls it once
  // (migration name `payment_templates_manual_v1`), which is what protects a later deliberate switch.
  const db = freshDb();
  seed(db, 'deposit_reminder', 'auto');
  runPaymentTemplatesToManualMigration(db);
  db.prepare("UPDATE email_templates SET sendMode = 'auto' WHERE stableKey = 'deposit_reminder'").run();

  assert.equal(runPaymentTemplatesToManualMigration(db).changed, 1);
  db.close();
});

test('a database without the columns is skipped, never crashed', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, name TEXT);');
  assert.deepEqual(runPaymentTemplatesToManualMigration(db), { action: 'skipped-schema', changed: 0 });
  db.close();
});
