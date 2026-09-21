// specs/guest-email-sequence.md §3.3 + §5 — the send ledger: one send per key, ever; the purge of
// email_log never reopens a key; the upgrade migration copies every past send into it.

const test = require('node:test');
const assert = require('node:assert/strict');

const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const emailLogModel = require('../models/emailLogModel');
const { runGuestEmailSequenceMigration } = require('../utils/migrateGuestEmailSequence');
const { freshDb, seedProperty, seedClient, seedReservation } = require('./guestEmailSequenceFixtures');

const KEY = { dedupKey: 'guest_thanks_j1:r1', stableKey: 'guest_thanks_j1', reservationId: 1, clientId: 1 };

// rules 11-12 — one row per dedup key, claimed before SMTP opens; the second claim loses.
test('a key is claimed once: the second claim loses, whatever its origin', () => {
  const ledger = guestEmailSendsModel.buildModel(freshDb());
  assert.equal(ledger.claim(KEY), true);
  assert.equal(ledger.claim(KEY), false);
  assert.equal(ledger.findByKey(KEY.dedupKey).status, 'claimed');
});

// rule 12 — a failed row may be re-claimed; a claimed, sent or skipped one never.
test('a failed send can be claimed again; a sent or skipped one never', () => {
  const ledger = guestEmailSendsModel.buildModel(freshDb());
  ledger.claim(KEY);
  ledger.markFailed(KEY.dedupKey, 'SMTP down');
  assert.equal(ledger.claim(KEY), true, 'failed → retried');
  ledger.markSent(KEY.dedupKey, { recipientEmail: 'c@x.fr', emailLogId: 9 });
  assert.equal(ledger.claim(KEY), false, 'sent → closed for ever');

  const skipped = { ...KEY, dedupKey: 'arrival_reminder_7d:r1', stableKey: 'arrival_reminder_7d' };
  assert.equal(ledger.recordOutsideSend({ ...skipped, status: 'skipped' }), true);
  assert.equal(ledger.claim(skipped), false, 'skipped by the operator → never sent afterwards');
  assert.equal(ledger.recordOutsideSend({ ...skipped, status: 'sent' }), false, 'a closed key stays as it is');
});

test('a deliberate resend gets a key of its own and never touches the original row', () => {
  const ledger = guestEmailSendsModel.buildModel(freshDb());
  ledger.claim(KEY);
  ledger.markSent(KEY.dedupKey);
  const first = ledger.nextResendKey(KEY.dedupKey);
  assert.equal(first, 'guest_thanks_j1:r1:resend:1');
  ledger.claim({ ...KEY, dedupKey: first });
  assert.equal(ledger.nextResendKey(KEY.dedupKey), 'guest_thanks_j1:r1:resend:2');
  assert.equal(ledger.findByKey(KEY.dedupKey).status, 'sent');
});

// rule 12bis — a skipped key does not count toward the yearly cap.
test('yearly cap count: post-stay emails sent to the client since the date, resends and skips excluded', () => {
  const db = freshDb();
  const ledger = guestEmailSendsModel.buildModel(db);
  const sent = (dedupKey, stableKey, sentAt, status = 'sent') => {
    ledger.claim({ dedupKey, stableKey, clientId: 1 });
    db.prepare('UPDATE guest_email_sends SET status = ?, sentAt = ? WHERE dedupKey = ?').run(status, sentAt, dedupKey);
  };
  sent('guest_thanks_j1:r1', 'guest_thanks_j1', '2027-07-18 08:00:00');
  sent('guest_thanks_j1:r1:resend:1', 'guest_thanks_j1', '2027-07-19 08:00:00');
  sent('season_gift_vouchers:c1:2027-11', 'season_gift_vouchers', '2027-11-15 08:00:00');
  sent('season_new_year:c1:2028-01', 'season_new_year', '2028-01-06 08:00:00', 'skipped');
  sent('arrival_reminder_7d:r1', 'arrival_reminder_7d', '2027-07-03 08:00:00');
  assert.equal(ledger.countPostStayContacts(1, '2027-01-01 00:00:00'), 2);
  assert.equal(ledger.countPostStayContacts(1, '2027-08-01 00:00:00'), 1);
});

// rule 14 — a claim older than an hour is reported, never silently re-sent.
test('a claim left open is reported as stale after an hour, never silently re-sent', () => {
  const db = freshDb();
  const ledger = guestEmailSendsModel.buildModel(db);
  ledger.claim(KEY);
  assert.equal(ledger.listStaleClaims(60).length, 0);
  db.prepare("UPDATE guest_email_sends SET claimedAt = datetime('now', '-2 hours')").run();
  assert.equal(ledger.listStaleClaims(60).length, 1);
  assert.equal(ledger.claim(KEY), false);
});

test('the email_log rolling-window purge never reopens a ledger key', () => {
  const db = freshDb();
  seedProperty(db);
  seedClient(db);
  const rid = seedReservation(db, { startDate: '2026-01-10', endDate: '2026-01-12' });
  const ledger = guestEmailSendsModel.buildModel(db);
  const log = emailLogModel.buildModel(db);
  const templateId = db.prepare("SELECT id FROM email_templates WHERE stableKey = 'guest_thanks_j1'").get().id;
  const row = log.insert({ templateId, reservationId: rid, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'c@x.fr' });
  ledger.claim({ ...KEY, dedupKey: `guest_thanks_j1:r${rid}`, reservationId: rid });
  ledger.markSent(`guest_thanks_j1:r${rid}`, { emailLogId: row.id });

  assert.ok(log.purgeRealizedStays('2026-09-18') >= 1, 'the history row is purged…');
  assert.equal(ledger.findByKey(`guest_thanks_j1:r${rid}`).status, 'sent', '…the ledger keeps the send');
  assert.equal(ledger.claim({ ...KEY, dedupKey: `guest_thanks_j1:r${rid}` }), false);
});

test('upgrade migration: copies past sends into the ledger and rewrites the three existing templates', () => {
  const db = freshDb();
  seedProperty(db);
  seedClient(db);
  const rid = seedReservation(db);
  const log = emailLogModel.buildModel(db);
  const j7 = db.prepare("SELECT id FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get().id;
  log.insert({ templateId: j7, reservationId: rid, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'c@x.fr' });
  log.insert({ templateId: j7, reservationId: rid, status: 'failed', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'c@x.fr' });
  db.prepare("UPDATE email_templates SET body = 'old copy', sendMode = 'manual' WHERE stableKey = 'arrival_reminder_7d'").run();

  const result = runGuestEmailSequenceMigration(db);

  assert.equal(result.ledgerBackfilled, 1, 'only the sent row counts');
  assert.equal(guestEmailSendsModel.buildModel(db).findByKey(`arrival_reminder_7d:r${rid}`).status, 'sent');
  const row = db.prepare("SELECT body, sendMode FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  assert.notEqual(row.body, 'old copy');
  assert.match(row.body, /Plus qu'une semaine/);
  // The registry ships the sequence « manual » (specs/settings-rationalization.md rule 17b).
  assert.equal(row.sendMode, 'manual');
  assert.equal(result.templatesSynced, 3);
});

test('upgrade migration: automatic sending already ON starts the sequence today, never earlier', () => {
  const db = freshDb();
  // The switch column is added by database.js, not by the schema.sql baseline.
  db.exec('ALTER TABLE app_settings ADD COLUMN emailAutoSendEnabled INTEGER NOT NULL DEFAULT 0');
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  runGuestEmailSequenceMigration(db);
  assert.equal(db.prepare('SELECT guestSequenceStartDate AS d FROM app_settings').get().d, null, 'OFF → not started');

  db.prepare('UPDATE app_settings SET emailAutoSendEnabled = 1').run();
  runGuestEmailSequenceMigration(db);
  const started = db.prepare('SELECT guestSequenceStartDate AS d FROM app_settings').get().d;
  assert.match(started, /^\d{4}-\d{2}-\d{2}$/);
  db.prepare("UPDATE app_settings SET guestSequenceStartDate = '2026-09-01'").run();
  runGuestEmailSequenceMigration(db);
  assert.equal(db.prepare('SELECT guestSequenceStartDate AS d FROM app_settings').get().d, '2026-09-01', 'never moved once set');
});
