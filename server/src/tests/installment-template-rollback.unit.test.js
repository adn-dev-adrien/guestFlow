// specs/self-update-and-releases.md rule 43 — a rollback to v3.18.0 must not list the installment request
// in its manual queue: the template carries an anchor that release ignores.
const test = require('node:test');
const assert = require('node:assert/strict');

const { runInstallmentTemplateAnchorMigration } = require('../utils/migrateInstallmentTemplateAnchor');
const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
const { templateWhen } = require('../utils/templateWhen');
const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');

const SENTINEL = '2000-01-01 00:00:00';

// The "start" branch of v3.18.0's emailLogModel.listPending, verbatim (its EVENT_TRIGGERED_STABLE_KEYS has
// five keys, without installment_request).
const V318_EVENT_KEYS = ['reservation_confirmation', 'deposit_request', 'balance_request', 'full_request', 'cancellation_notice'];
const V318_START_BRANCH = `
  SELECT t.stableKey AS stableKey, r.id AS reservationId
  FROM email_templates t
  JOIN reservations r
    ON COALESCE(r.kind, 'reservation') = 'reservation'
   AND date(r.startDate, t.dayOffset || ' days') BETWEEN date(?, '-' || ? || ' days') AND date(?)
   AND (t.dayOffset > 0 OR date(r.startDate) >= date(?))
  WHERE t.enabled = 1
    AND t.sendMode = 'manual'
    AND COALESCE(t.anchor, 'start') = 'start'
    AND COALESCE(t.stableKey, '') NOT IN (${V318_EVENT_KEYS.map(() => '?').join(', ')})`;

function v318Queue(db, today) {
  return db.prepare(V318_START_BRANCH).all(today, 7, today, today, ...V318_EVENT_KEYS).map((r) => r.stableKey);
}

function dbWithArrival() {
  const db = freshDb();
  const propertyId = seedProperty(db);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
  db.prepare("INSERT INTO reservations (clientId, propertyId, startDate, endDate, kind) VALUES (1, ?, '2026-11-06', '2026-11-09', 'reservation')").run(propertyId);
  return db;
}

test('rule 43 - the registry seeds installment_request with an anchor v3.18.0 does not read', () => {
  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'installment_request');
  assert.equal(def.anchor, 'installmentDueDate');
  assert.equal(def.sendMode, 'manual');
});

test('rule 43 - v3.18.0 queue logic over a seeded install lists no installment request for an arriving stay', () => {
  const db = dbWithArrival();
  db.prepare("UPDATE email_templates SET enabled = 1 WHERE stableKey = 'installment_request'").run();
  assert.equal(db.prepare("SELECT anchor FROM email_templates WHERE stableKey = 'installment_request'").get().anchor, 'installmentDueDate');
  assert.ok(!v318Queue(db, '2026-11-06').includes('installment_request'));
});

test('rule 43 - control: the same v3.18.0 queue logic does list the row when it sits on the start anchor', () => {
  const db = dbWithArrival();
  db.prepare("UPDATE email_templates SET anchor = 'start' WHERE stableKey = 'installment_request'").run();
  assert.ok(v318Queue(db, '2026-11-06').includes('installment_request'));
});

test('rule 43 - the migration moves an existing row off start, once, and a second run writes nothing', () => {
  const db = dbWithArrival();
  db.prepare("UPDATE email_templates SET anchor = 'start', updatedAt = ? WHERE stableKey = 'installment_request'").run(SENTINEL);
  assert.ok(v318Queue(db, '2026-11-06').includes('installment_request'));

  assert.deepEqual(runInstallmentTemplateAnchorMigration(db), { action: 'updated', changed: 1 });
  assert.ok(!v318Queue(db, '2026-11-06').includes('installment_request'));

  db.prepare("UPDATE email_templates SET updatedAt = ? WHERE stableKey = 'installment_request'").run(SENTINEL);
  const before = db.prepare('SELECT * FROM email_templates ORDER BY id').all();
  const changes = db.total_changes;
  assert.deepEqual(runInstallmentTemplateAnchorMigration(db), { action: 'unchanged', changed: 0 });
  assert.equal(db.total_changes, changes);
  assert.deepEqual(db.prepare('SELECT * FROM email_templates ORDER BY id').all(), before);
});

test('rule 43 - the migration leaves every other template and the operator edits of this one alone', () => {
  const db = freshDb();
  db.prepare("UPDATE email_templates SET enabled = 0, subject = 'Mine', dayOffset = 0 WHERE stableKey = 'installment_request'").run();
  const others = db.prepare("SELECT * FROM email_templates WHERE stableKey != 'installment_request' ORDER BY id").all();
  db.prepare("UPDATE email_templates SET anchor = 'start' WHERE stableKey = 'installment_request'").run();
  runInstallmentTemplateAnchorMigration(db);
  const row = db.prepare("SELECT enabled, subject, anchor FROM email_templates WHERE stableKey = 'installment_request'").get();
  assert.deepEqual(row, { enabled: 0, subject: 'Mine', anchor: 'installmentDueDate' });
  assert.deepEqual(db.prepare("SELECT * FROM email_templates WHERE stableKey != 'installment_request' ORDER BY id").all(), others);
});

test('rule 43 - a schema without the anchor column is skipped', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT)');
  assert.equal(runInstallmentTemplateAnchorMigration(db).action, 'skipped-schema');
});

test('rule 43 - the operator sees the fixed sentence and a label for the new anchor', () => {
  const when = templateWhen({ stableKey: 'installment_request', anchor: 'installmentDueDate', dayOffset: 0 });
  assert.equal(when.editable, false);
  assert.equal(when.label, 'À chaque échéance, à la demande');
  assert.equal(when.anchorLabel, 'l’échéance');
});
