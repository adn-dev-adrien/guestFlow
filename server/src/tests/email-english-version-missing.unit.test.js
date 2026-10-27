// specs/email-language-fr-en.md rule 9 (operator decision of 2026-10-27): a template without its
// English version is never sent to an English-speaking guest. The manual send is refused with a French
// message, the preview says so, the automatic passes skip it and the history shows why.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer } = require('./guestEmailSequenceFixtures');
const { call } = require('./emailTextsFixture');
const { buildController: buildEmails } = require('../controllers/emailsController');
const { buildController: buildTemplates } = require('../controllers/emailTemplatesController');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const { performAutoEmailPass } = require('../utils/emailAutoSendRunner');
const { sendSequenceMail } = require('../utils/guestEmailSequenceRunner');
const { stayDedupKey } = require('../utils/guestEmailSequence');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');

const MESSAGE = 'Version anglaise manquante pour ce modèle.';
// Rule 12 — the refused send also says what to do.
const ACTION = 'Version anglaise manquante pour ce modèle : la rédiger dans Emails › Modèles, ou passer le mail en français.';

function setup({ emailLanguage = 'en' } = {}) {
  const db = freshDb();
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.exec("ALTER TABLE clients ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'");
  db.exec('ALTER TABLE email_templates ADD COLUMN subjectEn TEXT');
  db.exec('ALTER TABLE email_templates ADD COLUMN bodyEn TEXT');
  db.prepare("UPDATE email_templates SET subjectEn = 'Subject EN', bodyEn = 'Body EN' WHERE stableKey IS NOT NULL").run();
  seedProperty(db, { id: 1, name: 'Le Gîte', nameArticle: 'au', nameArticleConfirmed: 1 });
  seedClient(db, { id: 1, email: 'ada@example.com', emailLanguage });
  const reservationId = seedReservation(db, { startDate: '2099-07-10', endDate: '2099-07-14' });
  const info = db.prepare(`INSERT INTO email_templates (name, subject, body, dayOffset, enabled, sendMode)
    VALUES ('Mot perso', 'Bonjour', 'Corps FR', -3, 1, 'auto')`).run();
  const mail = mailer();
  const stub = settingsStub({});
  const settingsModel = { ...stub, read: () => ({ ...stub.read(), companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => true };
  const deps = {
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel,
    emailServiceFactory: mail.factory,
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: emailPreferencesModel.buildModel(db),
  };
  return { db, deps, mail, reservationId, templateId: Number(info.lastInsertRowid), emails: buildEmails(deps) };
}

const failedRows = (db) => db.prepare("SELECT errorMessage FROM email_log WHERE status = 'failed'").all().map((r) => r.errorMessage);

test('the manual send to an English-speaking guest is refused in French; nothing leaves, nothing is logged', async () => {
  const { db, emails, mail, reservationId, templateId } = setup();
  const res = await call(emails.send, { body: { reservationId, templateId, overrides: { subject: 'Hi', body: 'Typed' } } });
  assert.equal(res.status, 422);
  assert.deepEqual(res.body, { error: 'ENGLISH_VERSION_MISSING', message: ACTION });
  assert.equal(mail.sent.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 0);
});

test('the preview says the English version is missing; a French guest is unaffected', async () => {
  const en = setup();
  const preview = await call(en.emails.preview, { query: { reservationId: en.reservationId, templateId: en.templateId } });
  assert.equal(preview.body.englishMissing, true);
  const fr = setup({ emailLanguage: 'fr' });
  assert.equal((await call(fr.emails.preview, { query: { reservationId: fr.reservationId, templateId: fr.templateId } })).body.englishMissing, false);
  const sent = await call(fr.emails.send, { body: { reservationId: fr.reservationId, templateId: fr.templateId } });
  assert.equal(sent.status, 200);
  assert.equal(fr.mail.sent.length, 1);
});

test('the operator writing this one in French (lang=fr) may send it', async () => {
  const { emails, mail, reservationId, templateId } = setup();
  const res = await call(emails.send, { body: { reservationId, templateId, lang: 'fr' } });
  assert.equal(res.status, 200);
  assert.equal(mail.sent.length, 1);
});

test('the templates list says which templates have no English version', async () => {
  const { db, templateId } = setup();
  const res = await call(buildTemplates(emailTemplatesModel.buildModel(db), { read: () => ({}) }).list, {});
  const byId = Object.fromEntries(res.body.map((t) => [t.id, t.hasEnglish]));
  assert.equal(byId[templateId], false);
  assert.equal(res.body.find((t) => t.stableKey === 'reservation_confirmation').hasEnglish, true);
});

test('the automatic pass skips it and logs the reason; the history words it', async () => {
  const { db, deps, mail, emails } = setup();
  const outcome = await performAutoEmailPass({ ...deps, today: '2099-07-07' });
  assert.equal(outcome.failedCount, 1);
  assert.equal(outcome.results[0].errorMessage, 'ENGLISH_VERSION_MISSING');
  assert.equal(mail.sent.length, 0);
  assert.deepEqual(failedRows(db), ['ENGLISH_VERSION_MISSING']);
  const history = await call(emails.history, { query: {} });
  const row = history.body.rows.find((r) => r.status === 'failed');
  assert.equal(row.errorLabel, MESSAGE);
});

test('the sequence skips a sequence mail without English, logs it and releases the ledger claim', async () => {
  const { db, deps, mail, reservationId } = setup();
  db.prepare("UPDATE email_templates SET bodyEn = '', subjectEn = '' WHERE stableKey = 'arrival_reminder_7d'").run();
  const dedupKey = stayDedupKey('arrival_reminder_7d', reservationId);
  const outcome = await sendSequenceMail(deps, { stableKey: 'arrival_reminder_7d', dedupKey, reservationId, clientId: 1 });
  assert.deepEqual(outcome, { sent: false, reason: 'ENGLISH_VERSION_MISSING' });
  assert.equal(mail.sent.length, 0);
  assert.deepEqual(failedRows(db), ['ENGLISH_VERSION_MISSING']);
  assert.equal(deps.ledger.findByKey(dedupKey).status, 'failed');
});

test('an event-triggered send (payment confirmation) skips it too', async () => {
  const { db, deps, mail, reservationId } = setup();
  db.prepare("UPDATE email_templates SET bodyEn = '' WHERE stableKey = 'deposit_request'").run();
  const outcome = await sendReservationTemplateEmail({ ...deps, reservationId, stableKey: 'deposit_request' });
  assert.deepEqual(outcome, { sent: false, reason: 'ENGLISH_VERSION_MISSING' });
  assert.equal(mail.sent.length, 0);
  assert.deepEqual(failedRows(db), ['ENGLISH_VERSION_MISSING']);
});
