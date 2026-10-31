// specs/payment-link-lifecycle.md rule 63 — the guest notice ships after the withdrawals it follows: a stay whose link
// was withdrawn for taken dates before this version is seeded `not-sent` / `upgrade` once (the card only), so the
// notice pass never mails its guest; a row already there is kept; a second boot does nothing. Made-up stays.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink } = require('./datesTakenFixture');
const { runDatesTakenNoticeBacklog, BACKLOG_MIGRATION_NAME } = require('../utils/datesTakenUpgradeMigration');
const { buildDatesTakenNotice } = require('../utils/datesTakenNotice');

const quiet = { log: () => {}, warn: () => {} };

test('rule 63 — withdrawn before this version: seeded once, never mailed; an existing row kept', async () => {
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
