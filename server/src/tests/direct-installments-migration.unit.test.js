// specs/direct-installments.md §5 — the two table rebuilds (payment_links, email_manual_queue) and the
// additive columns keep every existing row one-to-one, and running the migration again changes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');

// The tables as production has them before this change (CHECK without 'installment', queue keyed on the pair).
const BEFORE = `
  CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', finalPrice REAL);
  CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
  CREATE TABLE payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    type TEXT NOT NULL,
    providerLinkId TEXT,
    url TEXT NOT NULL DEFAULT '',
    amountCents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'open',
    providerPaymentId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    paidAt TEXT,
    expiresAt TEXT,
    lastPolledAt TEXT,
    provider TEXT NOT NULL DEFAULT 'qonto',
    remoteCancelPendingAt TEXT,
    cancelReason TEXT,
    CHECK (type IN ('deposit', 'balance', 'full', 'complement')),
    CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
  );
  CREATE INDEX idx_payment_links_reservation ON payment_links(reservationId);
  CREATE INDEX idx_payment_links_status ON payment_links(status);
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER,
    reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL,
    errorMessage TEXT DEFAULT '',
    renderedSubject TEXT NOT NULL,
    renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT 'smtp',
    CHECK (status IN ('sent', 'failed', 'acknowledged-skip'))
  );
  CREATE TABLE email_manual_queue (
    templateId    INTEGER NOT NULL,
    reservationId INTEGER NOT NULL,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (templateId, reservationId),
    FOREIGN KEY (templateId)    REFERENCES email_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id)    ON DELETE CASCADE
  );
`;

function productionLikeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(BEFORE);
  db.prepare('INSERT INTO reservations (id, finalPrice) VALUES (1, 500), (2, 800), (3, 300)').run();
  db.prepare("INSERT INTO email_templates (id, name) VALUES (1, 'A'), (2, 'B')").run();
  const link = db.prepare(`INSERT INTO payment_links
    (reservationId, type, providerLinkId, url, amountCents, status, providerPaymentId, createdAt, paidAt, expiresAt, lastPolledAt, provider, remoteCancelPendingAt, cancelReason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  link.run(1, 'deposit', 'ql_1', 'https://pay/1', 15000, 'paid', 'pay_1', '2026-09-01 10:00:00', '2026-09-02T08:00:00Z', null, '2026-09-02 08:00:00', 'qonto', null, null);
  link.run(1, 'balance', 'ql_2', 'https://pay/2', 35000, 'open', null, '2026-09-03 10:00:00', null, '2027-01-01T00:00:00Z', null, 'qonto', null, null);
  link.run(2, 'full', 'ql_3', 'https://pay/3', 80000, 'cancelled', null, '2026-09-04 10:00:00', null, null, null, 'qonto', '2026-09-05T00:00:00Z', 'amount-changed');
  link.run(3, 'complement', null, '', 4200, 'expired', null, '2026-09-06 10:00:00', null, null, null, 'other', null, 'settled');
  db.prepare('DELETE FROM payment_links WHERE id = 4').run();
  const log = db.prepare('INSERT INTO email_log (templateId, reservationId, status, errorMessage, renderedSubject, renderedBody, recipientEmail, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  log.run(1, 1, 'sent', '', 'Sujet 1', 'Corps 1', 'a@example.com', 'smtp');
  log.run(2, 2, 'failed', 'EMAIL_NOT_CONFIGURED', 'Sujet 2', 'Corps 2', 'b@example.com', 'smtp');
  log.run(null, 3, 'acknowledged-skip', '', 'Sujet 3', 'Corps 3', '', 'manual');
  db.prepare('INSERT INTO email_manual_queue (templateId, reservationId, createdAt) VALUES (1, 1, ?), (2, 1, ?), (1, 3, ?)')
    .run('2026-09-10 09:00:00', '2026-09-10 09:05:00', '2026-09-11 09:00:00');
  return db;
}

const dump = (db, table, columns) => db.prepare(`SELECT ${columns} FROM ${table} ORDER BY 1, 2`).all();
const LINK_COLUMNS = 'id, reservationId, type, providerLinkId, url, amountCents, currency, status, providerPaymentId, createdAt, paidAt, expiresAt, lastPolledAt, provider, remoteCancelPendingAt, cancelReason';
const LOG_COLUMNS = 'id, templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail, channel';
const QUEUE_COLUMNS = 'templateId, reservationId, createdAt';

test('the rebuilds keep every payment_links / email_log / email_manual_queue row, column for column', () => {
  const db = productionLikeDb();
  const before = {
    links: dump(db, 'payment_links', LINK_COLUMNS),
    log: dump(db, 'email_log', LOG_COLUMNS),
    queue: dump(db, 'email_manual_queue', QUEUE_COLUMNS),
  };
  assert.equal(before.links.length, 3);

  migrateInstallmentsSchema(db);

  assert.deepEqual(dump(db, 'payment_links', LINK_COLUMNS), before.links);
  assert.deepEqual(dump(db, 'email_log', LOG_COLUMNS), before.log);
  assert.deepEqual(dump(db, 'email_manual_queue', QUEUE_COLUMNS), before.queue);
  assert.deepEqual(db.prepare('SELECT DISTINCT occurrenceKey FROM email_log').all().map((r) => r.occurrenceKey), ['']);
  assert.deepEqual(db.prepare('SELECT DISTINCT occurrenceKey FROM email_manual_queue').all().map((r) => r.occurrenceKey), ['']);
  assert.deepEqual(db.prepare('SELECT DISTINCT installmentId FROM payment_links').all().map((r) => r.installmentId), [null]);
});

test('running the migration again changes nothing', () => {
  const db = productionLikeDb();
  migrateInstallmentsSchema(db);
  const snapshot = ['payment_links', 'email_log', 'email_manual_queue', 'reservations'].map((t) => db.prepare(`SELECT * FROM ${t}`).all());
  const schema = db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  migrateInstallmentsSchema(db);
  assert.deepEqual(['payment_links', 'email_log', 'email_manual_queue', 'reservations'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()), snapshot);
  assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(), schema);
});

test('the rebuilt payment_links accepts the installment type, still refuses an unknown one, and keeps its indexes', () => {
  const db = productionLikeDb();
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO payment_links (reservationId, type, installmentId, amountCents) VALUES (1, 'installment', 42, 33400)").run();
  assert.throws(() => db.prepare("INSERT INTO payment_links (reservationId, type) VALUES (1, 'weekly')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO payment_links (reservationId, type, status) VALUES (1, 'deposit', 'lost')").run(), /CHECK/);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'payment_links'").all().map((i) => i.name);
  for (const name of ['idx_payment_links_reservation', 'idx_payment_links_status', 'idx_payment_links_provider', 'idx_payment_links_installment']) {
    assert.ok(indexes.includes(name), name);
  }
});

test('ids are never reused: the rebuilt table carries on after the highest id ever issued', () => {
  const db = productionLikeDb();
  migrateInstallmentsSchema(db);
  const next = db.prepare("INSERT INTO payment_links (reservationId, type) VALUES (1, 'deposit')").run().lastInsertRowid;
  assert.equal(Number(next), 5, 'row 4 was deleted before the migration; its id stays retired');
});

test('the rebuilt queue holds the same template twice on one reservation, and still cascades with its parents', () => {
  const db = productionLikeDb();
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO email_manual_queue (templateId, reservationId, occurrenceKey) VALUES (1, 1, 'installment:7')").run();
  assert.throws(() => db.prepare("INSERT INTO email_manual_queue (templateId, reservationId, occurrenceKey) VALUES (1, 1, 'installment:7')").run(), /UNIQUE|PRIMARY/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_manual_queue WHERE templateId = 1 AND reservationId = 1').get().n, 2);
  db.prepare('DELETE FROM reservations WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_manual_queue WHERE reservationId = 1').get().n, 0, 'ON DELETE CASCADE survived the rebuild');
});

test('the stay gains its three installment aggregates, at 0', () => {
  const db = productionLikeDb();
  migrateInstallmentsSchema(db);
  const stay = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.deepEqual([stay.installmentsPaidAmount, stay.installmentsUnpaidAmount, stay.installmentsTarget], [0, 0, 0]);
});

test('a fresh database (baseline schema) is already in the new shape: the migration finds nothing to rebuild', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const before = db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('payment_links', 'email_manual_queue', 'email_log') ORDER BY name").all();
  migrateInstallmentsSchema(db);
  assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('payment_links', 'email_manual_queue', 'email_log') ORDER BY name").all(), before);
  assert.ok(db.prepare("PRAGMA table_info(reservation_installments)").all().length > 0);
});
