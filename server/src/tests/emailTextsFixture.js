/**
 * Shared fixture of the « Textes des emails » suites (specs/guest-email-texts-made-simple.md §7).
 * Not a test file: each suite imports what it needs, so no suite ever re-runs another.
 *
 * A fresh database with the neutral templates, one property « Le Gîte », one guest and one stay
 * starting in five days, plus the emails controller bound to it.
 */

const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer } = require('./guestEmailSequenceFixtures');
const { buildController: buildEmails } = require('../controllers/emailsController');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function call(handler, req = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      send(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this; },
    };
    Promise.resolve(handler({ body: {}, params: {}, query: {}, ...req }, res));
  });
}

function setup({ settings = {}, smtp = true, withStay = true } = {}) {
  const db = freshDb();
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  seedProperty(db, { id: 1, name: 'Le Gîte', nameArticle: 'au', nameArticleConfirmed: 1 });
  seedClient(db, { id: 1 });
  const reservationId = withStay
    ? seedReservation(db, { startDate: isoDay(5), endDate: isoDay(8), doubleBeds: 1 })
    : null;
  const mail = mailer();
  const stub = settingsStub(settings);
  const templatesModel = emailTemplatesModel.buildModel(db);
  const logModel = emailLogModel.buildModel(db);
  const emails = buildEmails({
    database: db,
    templatesModel,
    logModel,
    settingsModel: { ...stub, read: () => ({ ...stub.read(), companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => smtp },
    emailServiceFactory: mail.factory,
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: emailPreferencesModel.buildModel(db),
  });
  const templateId = (key) => db.prepare('SELECT id FROM email_templates WHERE stableKey = ?').get(key).id;
  return { db, emails, mail, reservationId, templateId, isoDay };
}

module.exports = { setup, call, isoDay };
