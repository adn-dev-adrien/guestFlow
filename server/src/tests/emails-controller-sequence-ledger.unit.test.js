// specs/guest-email-sequence.md rules 13 + 13bis — the operator paths of the emails controller go
// through the ledger: « Envoyer » refuses a sequence email already sent unless the resend is
// confirmed; « Marquer envoyé » and « Ignorer » close the key so the sequence never sends it after.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/emailsController');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer } = require('./guestEmailSequenceFixtures');

function setup() {
  const db = freshDb();
  seedProperty(db);
  seedClient(db);
  const reservationId = seedReservation(db);
  const mail = mailer();
  const ledger = guestEmailSendsModel.buildModel(db);
  const controller = buildController({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: { ...settingsStub(), smtpConfigured: () => true },
    emailServiceFactory: mail.factory,
    ledger,
    preferences: emailPreferencesModel.buildModel(db),
  });
  const templateId = (key) => db.prepare('SELECT id FROM email_templates WHERE stableKey = ?').get(key).id;
  return { db, controller, ledger, mail, reservationId, templateId };
}

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    Promise.resolve(handler(req, res));
  });
}

test('« Envoyer » on a sequence email: sent once, then 409 ALREADY_SENT', async () => {
  const { controller, ledger, mail, reservationId, templateId } = setup();
  const body = { reservationId, templateId: templateId('guest_thanks_j1') };
  const first = await call(controller.send, { body });
  assert.equal(first.status, 200);
  assert.equal(ledger.findByKey(`guest_thanks_j1:r${reservationId}`).status, 'sent');

  const second = await call(controller.send, { body });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'ALREADY_SENT');
  assert.ok(second.body.sentAt);
  assert.equal(mail.sent.length, 1);
});

test('a confirmed resend leaves once more, under a resend key of its own', async () => {
  const { controller, ledger, mail, reservationId, templateId } = setup();
  const body = { reservationId, templateId: templateId('arrival_reminder_1d') };
  await call(controller.send, { body });
  const resend = await call(controller.send, { body: { ...body, confirmResend: true } });
  assert.equal(resend.status, 200);
  assert.equal(mail.sent.length, 2);
  assert.equal(ledger.findByKey(`arrival_reminder_1d:r${reservationId}:resend:1`).status, 'sent');
  assert.equal(ledger.findByKey(`arrival_reminder_1d:r${reservationId}`).status, 'sent');
});

test('« Ignorer » and « Marquer envoyé » close the key: the sequence never sends it afterwards', async () => {
  const { controller, ledger, reservationId, templateId } = setup();
  await call(controller.acknowledge, { params: { templateId: templateId('arrival_reminder_7d'), reservationId } });
  assert.equal(ledger.findByKey(`arrival_reminder_7d:r${reservationId}`).status, 'skipped');
  await call(controller.markSent, { params: { templateId: templateId('arrival_reminder_1d'), reservationId } });
  assert.equal(ledger.findByKey(`arrival_reminder_1d:r${reservationId}`).status, 'sent');
  assert.equal(ledger.claim({ dedupKey: `arrival_reminder_7d:r${reservationId}`, stableKey: 'arrival_reminder_7d' }), false);
});

test('payment emails keep their own rules: no ledger key, sent again on demand', async () => {
  const { controller, db, mail, reservationId, templateId } = setup();
  const body = { reservationId, templateId: templateId('deposit_request') };
  assert.equal((await call(controller.send, { body })).status, 200);
  assert.equal((await call(controller.send, { body })).status, 200);
  assert.equal(mail.sent.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_email_sends').get().n, 0);
});

test('preview of a sequence email renders the per-property paragraphs', async () => {
  const { controller, reservationId, templateId } = setup();
  const res = await call(controller.preview, { query: { reservationId, templateId: templateId('arrival_reminder_1d') } });
  assert.equal(res.status, 200);
  assert.match(res.body.body, /vous n'avez pas choisi l'option ménage/);
  assert.deepEqual(res.body.missingVariables, []);
});
