// Idempotent boot-time seed of every registry default. See specs/email-automation.md §3 rule 6.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { DEFAULT_TEMPLATES, PAYMENT_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');

const SILENT = { log() {} };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stableKey TEXT UNIQUE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      dayOffset INTEGER NOT NULL,
      sendMode TEXT NOT NULL DEFAULT 'manual',
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('fresh DB: every registry entry is inserted exactly once', () => {
  const db = freshDb();
  const result = ensureDefaultEmailTemplates(db, { logger: SILENT });
  assert.equal(result.insertedKeys.length, DEFAULT_TEMPLATES.length);
  assert.equal(result.skippedKeys.length, 0);

  const row = db.prepare("SELECT * FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  assert.ok(row, 'arrival_reminder_7d landed in the DB');
  assert.equal(row.dayOffset, -7);
  assert.equal(row.sendMode, 'manual');
  assert.equal(row.enabled, 1);
});

test('second run is a no-op: every registry entry skipped, no duplicates', () => {
  const db = freshDb();
  ensureDefaultEmailTemplates(db, { logger: SILENT });
  const result2 = ensureDefaultEmailTemplates(db, { logger: SILENT });
  assert.equal(result2.insertedKeys.length, 0);
  assert.equal(result2.skippedKeys.length, DEFAULT_TEMPLATES.length);
  const count = db.prepare('SELECT COUNT(*) AS n FROM email_templates').get().n;
  assert.equal(count, DEFAULT_TEMPLATES.length);
});

test('operator edits to a seeded row are NEVER overwritten by the next seed pass', () => {
  const db = freshDb();
  ensureDefaultEmailTemplates(db, { logger: SILENT });
  db.prepare("UPDATE email_templates SET subject = 'Custom!' WHERE stableKey = 'arrival_reminder_7d'").run();

  ensureDefaultEmailTemplates(db, { logger: SILENT });

  const row = db.prepare("SELECT subject FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  assert.equal(row.subject, 'Custom!', 'operator subject preserved');
});

test('a deleted seeded row is re-inserted on the next boot', () => {
  const db = freshDb();
  ensureDefaultEmailTemplates(db, { logger: SILENT });
  db.prepare("DELETE FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").run();

  const result = ensureDefaultEmailTemplates(db, { logger: SILENT });
  assert.deepEqual(result.insertedKeys, ['arrival_reminder_7d']);
  const row = db.prepare("SELECT * FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  assert.ok(row, 're-seeded after deletion');
});

test('missing schema (no stableKey column) → silent skip, no crash', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY)');
  const result = ensureDefaultEmailTemplates(db, { logger: SILENT });
  assert.equal(result.action, 'skipped-schema');
});

test('three consecutive runs: insert once, skip thereafter — idempotent', () => {
  const db = freshDb();
  const r1 = ensureDefaultEmailTemplates(db, { logger: SILENT });
  const r2 = ensureDefaultEmailTemplates(db, { logger: SILENT });
  const r3 = ensureDefaultEmailTemplates(db, { logger: SILENT });
  assert.equal(r1.insertedKeys.length, DEFAULT_TEMPLATES.length);
  assert.equal(r2.insertedKeys.length, 0);
  assert.equal(r3.insertedKeys.length, 0);
});


// specs/payment-schedule-and-cancellation.md §1 amendment, rule 44 — the guard rail. A money email is a
// commercial act: the server cannot know the acompte arrived by transfer this morning or that a delay
// was agreed by phone. Whoever adds the next dunning template has to make the same choice deliberately.
test('no template that asks a guest for money may ship as auto-send (rule 44)', () => {
  const offenders = DEFAULT_TEMPLATES
    .filter((t) => PAYMENT_STABLE_KEYS.includes(t.stableKey) && t.sendMode === 'auto')
    .map((t) => t.stableKey);
  assert.deepEqual(offenders, [], 'these would mail a guest without the operator ever seeing it');
});

test('every payment stable key actually exists in the registry', () => {
  const known = new Set(DEFAULT_TEMPLATES.map((t) => t.stableKey));
  assert.deepEqual(PAYMENT_STABLE_KEYS.filter((k) => !known.has(k)), [], 'a stale key guards nothing');
});
