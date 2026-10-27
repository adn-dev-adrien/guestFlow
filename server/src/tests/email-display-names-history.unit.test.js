// specs/guest-email-texts-made-simple.md rule 44, fixed at the 2026-10-27 spec review: the history and
// the pending list name a shipped e-mail as every other page does (« Merci et avis »), never by its
// stored name (« Séquence — J+1 merci et avis »); the templates list (history filter, send dialog) is
// in stay order.

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

function setup() {
  const db = freshDb();
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  seedProperty(db, { id: 1, name: 'Le Gîte', nameArticle: 'au', nameArticleConfirmed: 1 });
  seedClient(db, { id: 1 });
  const reservationId = seedReservation(db, { startDate: '2099-07-10', endDate: '2099-07-14' });
  const stub = settingsStub({});
  const emails = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: { ...stub, smtpConfigured: () => true },
    emailServiceFactory: mailer().factory,
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: emailPreferencesModel.buildModel(db),
  });
  const idOf = (key) => db.prepare('SELECT id FROM email_templates WHERE stableKey = ?').get(key).id;
  return { db, emails, reservationId, idOf };
}

test('the history names the J+1 « Merci et avis »', async () => {
  const { db, emails, reservationId, idOf } = setup();
  emailLogModel.buildModel(db).insert({ templateId: idOf('guest_thanks_j1'), reservationId, status: 'sent', renderedSubject: 'S', renderedBody: 'B' });
  const res = await call(emails.history, { query: {} });
  assert.equal(res.body.rows[0].templateName, 'Merci et avis');
});

test('the pending list names the J-7 « Préparation du séjour »', async () => {
  const { db, emails } = setup();
  db.exec(`
    ALTER TABLE reservations ADD COLUMN installmentsPaidAmount REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsUnpaidAmount REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsTarget REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsLastPaidDate TEXT;
  `);
  const res = await call(emails.pending, { query: { today: '2099-07-03' } });
  const row = res.body.find((r) => r.stableKey === 'arrival_reminder_7d' || /Préparation/.test(r.templateName));
  assert.ok(row, 'the J-7 is pending');
  assert.equal(row.templateName, 'Préparation du séjour');
  assert.ok(res.body.every((r) => !/^Séquence/.test(r.templateName)));
});

test('the templates list is in stay order: confirmation, then the J-7, the J-2, the J+1', async () => {
  const { db } = setup();
  const res = await call(buildTemplates(emailTemplatesModel.buildModel(db), { read: () => ({}) }).list, {});
  const keys = res.body.map((t) => t.stableKey);
  const at = (k) => keys.indexOf(k);
  assert.ok(at('reservation_confirmation') < at('arrival_reminder_7d'));
  assert.ok(at('arrival_reminder_7d') < at('arrival_reminder_1d'));
  assert.ok(at('arrival_reminder_1d') < at('guest_thanks_j1'));
  assert.ok(at('guest_thanks_j1') < at('season_gift_vouchers'));
});
