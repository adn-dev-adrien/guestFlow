// specs/gate-access-portier.md §3.2 + §5 — email_log learns `waiting_portier` and `skipped`.
//
// SQLite cannot alter a CHECK constraint, so the table is rebuilt. A rebuild that loses an id, a
// status or a sent body would silently rewrite the email history, so the copy is pinned here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runEmailLogPortierMigration, emailLogAcceptsWaiting } = require('../utils/emailLogPortierMigration');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function oldInstance() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL,
      sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL, errorMessage TEXT DEFAULT '',
      renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL, recipientEmail TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'smtp',
      CHECK (status IN ('sent', 'failed', 'acknowledged-skip'))
    );
    CREATE INDEX idx_email_log_reservation ON email_log(reservationId);
  `);
  const insert = db.prepare(`INSERT INTO email_log (id, templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail, channel)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run(3, 1, 10, '2026-09-01 08:00:00', 'sent', '', 'Votre séjour', 'Bonjour Camille', 'camille@example.com', 'smtp');
  insert.run(7, 2, 10, '2026-09-02 08:00:00', 'failed', 'EMAIL_NOT_CONFIGURED', 'Solde', 'Corps', 'camille@example.com', 'smtp');
  insert.run(9, 3, 11, '2026-09-03 08:00:00', 'acknowledged-skip', '', 'J-2', 'Corps J-2', '', 'manual');
  return db;
}

const statusInsert = (db, status) => db.prepare(`INSERT INTO email_log (templateId, reservationId, status, renderedSubject, renderedBody)
                                                 VALUES (1, 10, ?, '', '')`).run(status);

test('before: the log refuses the two new statuses', () => {
  const db = oldInstance();
  assert.equal(emailLogAcceptsWaiting(db), false);
  assert.throws(() => statusInsert(db, 'waiting_portier'), /CHECK constraint/);
});

test('the rebuild carries every row over with its id and every value, and accepts the new statuses', () => {
  const db = oldInstance();
  const before = db.prepare('SELECT * FROM email_log ORDER BY id').all();

  const result = db.transaction(() => runEmailLogPortierMigration(db))();

  assert.deepEqual(result, { rebuilt: true, rows: 3 });
  const after = db.prepare('SELECT id, templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail, channel FROM email_log ORDER BY id').all();
  assert.deepEqual(after, before);
  const columns = db.prepare('PRAGMA table_info(email_log)').all().map((c) => c.name);
  for (const column of ['nextAttemptAt', 'waitingSince', 'adminNotifiedAt']) assert.ok(columns.includes(column), column);

  statusInsert(db, 'waiting_portier');
  statusInsert(db, 'skipped');
  assert.throws(() => statusInsert(db, 'waiting'), /CHECK constraint/, 'the constraint is still there');
  assert.equal(db.prepare('SELECT MIN(id) AS id FROM email_log WHERE status = ?').get('waiting_portier').id, 10,
    'ids keep growing from the highest one carried over');
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'email_log'").all().map((r) => r.name);
  assert.ok(indexes.includes('idx_email_log_reservation'));
  assert.ok(indexes.includes('idx_email_log_waiting'));
});

test('a second run changes nothing, and a fresh install ends on the same table', () => {
  const db = oldInstance();
  db.transaction(() => runEmailLogPortierMigration(db))();
  assert.deepEqual(runEmailLogPortierMigration(db), { rebuilt: false, rows: 0 });

  const fresh = new Database(':memory:');
  fresh.exec(SCHEMA);
  assert.equal(fresh.transaction(() => runEmailLogPortierMigration(fresh))().rebuilt, true);
  const shape = (d) => d.prepare('PRAGMA table_info(email_log)').all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
  assert.deepEqual(shape(fresh), shape(db));
});
