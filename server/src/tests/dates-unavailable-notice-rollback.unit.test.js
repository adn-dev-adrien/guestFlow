// specs/self-update-and-releases.md rule 43, reading of 2026-11-01, and specs/payment-link-lifecycle.md rule 45 (audit
// R11 console N1) — a rollback to v3.19.0 must not offer « Dates plus disponibles » for every stay on its arrival day:
// the template is seeded on the `datesTaken` anchor, which that release's queue never reads, and the one-shot
// migration moves a row already seeded on `start`, once.
const test = require('node:test');
const assert = require('node:assert/strict');

const { runDatesUnavailableNoticeAnchorMigration, ANCHOR } = require('../utils/migrateDatesUnavailableNoticeAnchor');
const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
const { templateWhen } = require('../utils/templateWhen');
const { localIsoDate } = require('../utils/localDate');
const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const { floorQueue } = require('./rollbackFloorQueue');

const KEY = 'dates_unavailable_notice';
const SENTINEL = '2000-01-01 00:00:00'; // date-literal-ok: an updatedAt marker far in the past, never a stay date
const today = localIsoDate(new Date());

function dbWithArrivalToday() {
  const db = freshDb();
  const propertyId = seedProperty(db);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
  db.prepare("INSERT INTO reservations (clientId, propertyId, startDate, endDate, kind) VALUES (1, ?, ?, date(?, '+3 days'), 'reservation')").run(propertyId, today, today);
  return db;
}

test('rule 43 (R11 N1) - the registry seeds the notice on an anchor v3.19.0 does not read', () => {
  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === KEY);
  assert.equal(def.anchor, 'datesTaken');
  assert.equal(ANCHOR, 'datesTaken');
});

test('rule 43 (R11 N1) - v3.19.0 queue logic over a seeded install offers no notice for a stay arriving today', () => {
  const db = dbWithArrivalToday();
  assert.equal(db.prepare('SELECT anchor FROM email_templates WHERE stableKey = ?').get(KEY).anchor, 'datesTaken');
  assert.ok(!floorQueue(db, today).includes(KEY));
});

test('rule 43 (R11 N1) - control: the same queue does offer it while the row sits on start', () => {
  const db = dbWithArrivalToday();
  db.prepare("UPDATE email_templates SET anchor = 'start' WHERE stableKey = ?").run(KEY);
  assert.ok(floorQueue(db, today).includes(KEY));
});

test('rule 43 (R11 N1) - the migration moves a row seeded on start, once, and a second run writes nothing', () => {
  const db = dbWithArrivalToday();
  db.prepare("UPDATE email_templates SET anchor = 'start', updatedAt = ? WHERE stableKey = ?").run(SENTINEL, KEY);
  assert.deepEqual(runDatesUnavailableNoticeAnchorMigration(db), { action: 'updated', changed: 1 });
  assert.ok(!floorQueue(db, today).includes(KEY));

  const before = db.prepare('SELECT * FROM email_templates ORDER BY id').all();
  const changes = db.total_changes;
  assert.deepEqual(runDatesUnavailableNoticeAnchorMigration(db), { action: 'unchanged', changed: 0 });
  assert.equal(db.total_changes, changes);
  assert.deepEqual(db.prepare('SELECT * FROM email_templates ORDER BY id').all(), before);
});

test('rule 43 (R11 N1) - the migration leaves the other templates and the operator edits of this one alone', () => {
  const db = freshDb();
  db.prepare("UPDATE email_templates SET enabled = 0, subject = 'Mine', anchor = 'start' WHERE stableKey = ?").run(KEY);
  const others = db.prepare('SELECT * FROM email_templates WHERE stableKey != ? ORDER BY id').all(KEY);
  runDatesUnavailableNoticeAnchorMigration(db);
  assert.deepEqual(db.prepare('SELECT enabled, subject, anchor FROM email_templates WHERE stableKey = ?').get(KEY), { enabled: 0, subject: 'Mine', anchor: 'datesTaken' });
  assert.deepEqual(db.prepare('SELECT * FROM email_templates WHERE stableKey != ? ORDER BY id').all(KEY), others);
});

test('rule 43 (R11 N1) - a schema without the anchor column is skipped', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT)');
  assert.equal(runDatesUnavailableNoticeAnchorMigration(db).action, 'skipped-schema');
});

test('rule 43 (R11 N1) - the operator still reads the fixed sentence, with a label for the new anchor', () => {
  const when = templateWhen({ stableKey: KEY, anchor: 'datesTaken', dayOffset: 0 });
  assert.equal(when.editable, false);
  assert.equal(when.label, 'Quand les dates sont prises');
  assert.equal(when.anchorLabel, 'la prise des dates');
});
