// specs/payment-link-lifecycle.md rule 64 — the guest notice ships after the withdrawals it follows: a stay whose link
// was withdrawn for taken dates before this version is seeded `not-sent` / `upgrade` once (the card only), so the
// notice pass never mails its guest; a row already there is kept; a second boot does nothing. Made-up stays.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink } = require('./datesTakenFixture');
const { runDatesTakenNoticeBacklog, BACKLOG_MIGRATION_NAME } = require('../utils/datesTakenUpgradeMigration');
const { buildDatesTakenNotice } = require('../utils/datesTakenNotice');

const quiet = { log: () => {}, warn: () => {} };

test('rule 64 — withdrawn before this version: seeded once, never mailed; an existing row kept', async () => {
  const propertyId = freshProperty();
  const devis = addStay({ propertyId, kind: 'devis', start: inDays(30), end: inDays(33) });
  const known = addStay({ propertyId, kind: 'devis', start: inDays(30), end: inDays(33) });
  const taker = addStay({ propertyId, platform: 'Booking', start: inDays(31), end: inDays(32) });
  for (const stay of [devis, known]) {
    const id = addLink(stay);
    db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'dates-taken', remoteCancelPendingAt = NULL WHERE id = ?").run(id);
  }
  db.prepare("INSERT INTO dates_taken_notices (reservationId, noticeStatus, noticeReason) VALUES (?, 'sent', NULL)").run(known);
  db.prepare('DELETE FROM migrations WHERE name = ?').run(BACKLOG_MIGRATION_NAME);

  const first = runDatesTakenNoticeBacklog(db, { logger: quiet });
  assert.equal(first.ran, true);
  assert.equal(first.seeded, 1);
  const row = db.prepare('SELECT noticeStatus, noticeReason, takenByReservationId FROM dates_taken_notices WHERE reservationId = ?').get(devis);
  assert.deepEqual({ ...row }, { noticeStatus: 'not-sent', noticeReason: 'upgrade', takenByReservationId: taker });
  assert.equal(db.prepare('SELECT noticeStatus FROM dates_taken_notices WHERE reservationId = ?').get(known).noticeStatus, 'sent');

  const mails = [];
  const notice = buildDatesTakenNotice({
    database: db, settingsModel: { read: () => ({}), decryptedSmtpSettings: () => ({}) },
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { mails.push(m); } }), push: async () => {}, logger: quiet,
  });
  await notice.runDueNotices();
  assert.equal(mails.length, 0);
  assert.equal(runDatesTakenNoticeBacklog(db, { logger: quiet }).ran, false, 'once');
});

test('rule 64 (review of #912, m1) — a table created before `sending` is rebuilt once with it, rows and ids kept', () => {
  const Database = require('better-sqlite3');
  const { widenNoticeStatuses } = require('../utils/datesTakenUpgradeMigration');
  const old = new Database(':memory:');
  old.exec(`CREATE TABLE dates_taken_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL UNIQUE, takenByReservationId INTEGER, emailLogId INTEGER,
    noticeStatus TEXT NOT NULL CHECK (noticeStatus IN ('sent', 'not-sent')), noticeReason TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT)`);
  old.prepare("INSERT INTO dates_taken_notices (id, reservationId, noticeStatus, noticeReason) VALUES (7, 41, 'not-sent', 'upgrade')").run();
  assert.equal(widenNoticeStatuses(old), true);
  assert.equal(widenNoticeStatuses(old), false, 'idempotent');
  assert.deepEqual({ ...old.prepare('SELECT id, reservationId, noticeStatus, noticeReason FROM dates_taken_notices').get() },
    { id: 7, reservationId: 41, noticeStatus: 'not-sent', noticeReason: 'upgrade' });
  old.prepare("INSERT INTO dates_taken_notices (reservationId, noticeStatus) VALUES (42, 'sending')").run();
  assert.throws(() => old.prepare("INSERT INTO dates_taken_notices (reservationId, noticeStatus) VALUES (43, 'bogus')").run());
  old.close();
});
