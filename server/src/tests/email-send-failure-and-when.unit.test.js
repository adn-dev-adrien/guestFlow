// specs/email-automation.md rules 15–16 — a failed send is told in French, never as a code or the
// transport's own words (rule 15); the « Quand » of a template follows what it is tied to (rule 16).
// The Paris time of the history is checked at the end, against its own spec.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer } = require('./guestEmailSequenceFixtures');
const { call } = require('./emailTextsFixture');
const { buildController: buildEmails } = require('../controllers/emailsController');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const { sendFailureMessage, MESSAGES } = require('../utils/sendFailure');
const { templateWhenLabel } = require('../utils/templateWhen');
const { parisDateTimeLabel } = require('../utils/parisDateTime');

function emailsWith(failWith) {
  const db = freshDb();
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  seedProperty(db, { id: 1, name: 'Le Gîte', nameArticle: 'au', nameArticleConfirmed: 1 });
  seedClient(db, { id: 1 });
  const reservationId = seedReservation(db, { startDate: '2099-07-10', endDate: '2099-07-14' });
  const mail = mailer({ failWith });
  const stub = settingsStub({});
  const emails = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: { ...stub, read: () => ({ ...stub.read(), companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => true },
    emailServiceFactory: mail.factory,
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: emailPreferencesModel.buildModel(db),
  });
  const templateId = db.prepare("SELECT id FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get().id;
  return { db, emails, reservationId, templateId };
}

test('rule 15: each failure in French, with where to fix it', () => {
  assert.equal(sendFailureMessage({ message: 'Missing credentials for "PLAIN"', code: 'EAUTH' }), MESSAGES.auth);
  assert.equal(sendFailureMessage({ message: 'Invalid login: 535 5.7.8' }), MESSAGES.auth);
  assert.equal(sendFailureMessage({ message: 'getaddrinfo ENOTFOUND smtp.x', code: 'EDNS' }), MESSAGES.unreachable);
  assert.equal(sendFailureMessage({ code: 'EMAIL_NOT_CONFIGURED' }), 'Envoi non configuré : Paramètres › Emails.');
  assert.equal(sendFailureMessage({ code: 'EENVELOPE', message: 'No recipients defined' }), MESSAGES.recipient);
  assert.equal(sendFailureMessage({ code: 'PLATFORM_MAIL_DAILY_LIMIT', message: 'Limite atteinte : 3 envois par jour.' }), 'Limite atteinte : 3 envois par jour.');
  assert.equal(sendFailureMessage(new Error('boom')), 'Envoi impossible : réessayer plus tard.');
  assert.ok(Object.values(MESSAGES).every((m) => !/[A-Z]{3,}_|PLAIN|EAUTH/.test(m)));
});

test('rule 15: the send endpoint answers the French reason, and the history words the stored failure', async () => {
  const { emails, reservationId, templateId } = emailsWith('Missing credentials for "PLAIN"');
  const res = await call(emails.send, { body: { reservationId, templateId } });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'EMAIL_SEND_FAILED');
  assert.equal(res.body.message, MESSAGES.auth);
  const history = await call(emails.history, { query: {} });
  const row = history.body.rows.find((r) => r.status === 'failed');
  assert.ok(row);
  assert.equal(row.errorLabel, MESSAGES.auth);
});

test('rule 16: « Quand » follows the anchor, not only the day offset', () => {
  assert.equal(templateWhenLabel({ stableKey: 'reservation_confirmation', dayOffset: 0 }), 'À la réservation');
  assert.equal(templateWhenLabel({ stableKey: 'season_gift_vouchers', dayOffset: 0 }), '15 nov.');
  assert.equal(templateWhenLabel({ stableKey: 'season_new_year', dayOffset: 0 }), '6 janv.');
  assert.equal(templateWhenLabel({ stableKey: 'cancellation_notice', dayOffset: 0 }), 'À l’annulation');
  assert.equal(templateWhenLabel({ stableKey: 'balance_request', dayOffset: 0 }), 'À la demande');
  assert.equal(templateWhenLabel({ stableKey: 'arrival_reminder_7d', dayOffset: -7 }), 'J-7');
  assert.equal(templateWhenLabel({ stableKey: null, dayOffset: 0, anchor: 'start' }), 'Jour J');
  assert.equal(templateWhenLabel({ stableKey: null, dayOffset: 1, anchor: 'end' }), 'Lendemain du départ');
  assert.equal(templateWhenLabel({ stableKey: null, dayOffset: 3 }), 'J+3');
});

test('rule 16: the templates list carries the label', async () => {
  const db = freshDb();
  const { buildController } = require('../controllers/emailTemplatesController');
  const res = await call(buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) }).list, {});
  const byKey = Object.fromEntries(res.body.map((t) => [t.stableKey, t.whenLabel]));
  assert.equal(byKey.reservation_confirmation, 'À la réservation');
  assert.equal(byKey.arrival_reminder_1d, 'J-2');
});

test('specs/email-history-rolling-window.md rule 8: a SQLite UTC time reads in Paris', () => {
  assert.equal(parisDateTimeLabel('2026-10-18 00:11:00'), '18/10/2026 02:11');
  assert.equal(parisDateTimeLabel('2026-01-15 23:30:00'), '16/01/2026 00:30');
  assert.equal(parisDateTimeLabel('2026-10-18T00:11:00.000Z'), '18/10/2026 02:11');
  assert.equal(parisDateTimeLabel(''), '');
});

test('specs/email-history-rolling-window.md rule 8: the history rows carry the Paris label', async () => {
  const { db, emails, reservationId, templateId } = emailsWith(null);
  await call(emails.send, { body: { reservationId, templateId } });
  db.prepare("UPDATE email_log SET sentAt = '2026-10-18 00:11:00'").run();
  const history = await call(emails.history, { query: {} });
  assert.equal(history.body.rows[0].sentAtLabel, '18/10/2026 02:11');
});
