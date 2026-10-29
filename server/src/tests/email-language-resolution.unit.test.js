// specs/email-client-language-and-fiche-polish.md rule 2 and specs/email-language-fr-en.md rule 3b — the
// language of a guest e-mail comes from the CLIENT (then the reservation, then French); an explicit
// `lang` on the preview wins over all of them.
const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer } = require('./guestEmailSequenceFixtures');
const { call } = require('./emailTextsFixture');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const { buildController: buildEmails } = require('../controllers/emailsController');

function setup(emailLanguage) {
  const db = freshDb();
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.exec("ALTER TABLE clients ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'");
  db.exec('ALTER TABLE email_templates ADD COLUMN subjectEn TEXT');
  db.exec('ALTER TABLE email_templates ADD COLUMN bodyEn TEXT');
  seedProperty(db, { id: 1, name: 'Le Gîte', nameArticle: 'au', nameArticleConfirmed: 1 });
  seedClient(db, { id: 1, email: 'ada@example.com', emailLanguage });
  const reservationId = seedReservation(db, { startDate: '2099-07-10', endDate: '2099-07-14' });
  const info = db.prepare(`INSERT INTO email_templates (name, subject, body, subjectEn, bodyEn, dayOffset, enabled, sendMode)
    VALUES ('Mot perso', 'Bonjour', 'Corps FR', 'Hello', 'Body EN', -3, 1, 'manual')`).run();
  const mail = mailer();
  const stub = settingsStub({});
  const settingsModel = { ...stub, read: () => ({ ...stub.read(), companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => true };
  const emails = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel,
    emailServiceFactory: mail.factory,
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: emailPreferencesModel.buildModel(db),
  });
  return { emails, reservationId, templateId: Number(info.lastInsertRowid) };
}

async function previewLang({ emailLanguage, lang }) {
  const { emails, reservationId, templateId } = setup(emailLanguage);
  const res = await call(emails.preview, { query: { reservationId, templateId, ...(lang ? { lang } : {}) } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test('rule 2: an English client gets the English side, a French client the French one', async () => {
  const en = await previewLang({ emailLanguage: 'en' });
  assert.equal(en.lang, 'en');
  assert.match(en.body, /Body EN/);
  const fr = await previewLang({ emailLanguage: 'fr' });
  assert.equal(fr.lang, 'fr');
  assert.match(fr.body, /Corps FR/);
});

// specs/email-language-fr-en.md rule 3b
test('rule 3b: an explicit lang wins over the client language, in both directions', async () => {
  const forced = await previewLang({ emailLanguage: 'fr', lang: 'en' });
  assert.equal(forced.lang, 'en');
  assert.match(forced.body, /Body EN/);
  const back = await previewLang({ emailLanguage: 'en', lang: 'fr' });
  assert.equal(back.lang, 'fr');
  assert.match(back.body, /Corps FR/);
});
