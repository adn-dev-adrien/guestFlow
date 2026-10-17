// specs/guest-email-texts-made-simple.md §3.D rules 13–15 — the full email rendered by the server from
// the draft being typed, on the next stay that receives it (or « Exemple »), never saved; the English
// gap said; a test sent to the company's own address and recorded nowhere.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call, isoDay } = require('./emailTextsFixture');
const { seedReservation, seedClient } = require('./guestEmailSequenceFixtures');
const { buildController: buildEmails } = require('../controllers/emailsController');
const emailTemplatesModel = require('../models/emailTemplatesModel');

test('rule 13: the draft is rendered on the next stay that receives the email, and nothing is saved', async () => {
  const { db, emails, reservationId, templateId } = setup();
  seedClient(db, { id: 2, firstName: 'Paul' });
  seedReservation(db, { clientId: 2, startDate: isoDay(40), endDate: isoDay(42) });
  const before = db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n;
  const res = await call(emails.previewDraft, { body: {
    templateId: templateId('arrival_reminder_1d'),
    language: 'fr',
    draft: {
      texts: { 'text:house': { fr: 'Café et thé vous attendent.' } },
      arrival: { 1: { address: '12 chemin des Prés', wifiName: 'Gite-Invites' } },
      settings: { companyPhone: '06 99 99 99 99' },
    },
  } });
  assert.equal(res.status, 200);
  assert.equal(res.body.reservationId, reservationId);
  assert.equal(res.body.sample, false);
  assert.match(res.body.body, /^Bonjour Camille,/);
  assert.match(res.body.body, /Café et thé vous attendent\./);
  assert.match(res.body.body, /- Adresse : 12 chemin des Prés/);
  assert.match(res.body.body, /Appelez-nous au 06 99 99 99 99/);
  assert.deepEqual(res.body.reservations.map((r) => r.id), [reservationId, reservationId + 1]);
  assert.match(res.body.reservations[0].label, /^Camille Martin · Le Gîte · \d{2}\/\d{2}\/\d{4}$/);
  // Rolled back: no text, no arrival fact, nothing.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_arrival_facts').get().n, 0);

  const other = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_1d'), reservationId: reservationId + 1 } });
  assert.match(other.body.body, /^Bonjour Paul,/);
});

test('rule 13: « Exemple » when there is no stay to come, or when asked; never kept', async () => {
  const { db, emails, templateId } = setup({ withStay: false });
  const res = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_1d') } });
  assert.equal(res.status, 200);
  assert.equal(res.body.sample, true);
  assert.equal(res.body.reservationId, null);
  assert.match(res.body.body, /^Bonjour Camille,/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 1);

  const byStableKey = await call(emails.previewDraft, { body: { stableKey: 'arrival_reminder_1d', reservationId: 'sample' } });
  assert.equal(byStableKey.body.sample, true);
});

test('rule 13: a refused draft answers the same 422 as a save', async () => {
  const { emails, templateId } = setup();
  const res = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_7d'), draft: { texts: { 'text:beds.made': { fr: '{{prenon}}' } } } } });
  assert.equal(res.status, 422);
  assert.equal(res.body.message, 'Variable inconnue : {{prenon}}');
  const tpl = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_7d'), draft: { template: { body: 'Bonjour {{prenon}}' } } } });
  assert.equal(tpl.status, 422);
});

test('rule 14: the English preview says what the English reader misses', async () => {
  const { db, emails, templateId } = setup();
  const id = templateId('arrival_reminder_1d');
  const fr = await call(emails.previewDraft, { body: { templateId: id, language: 'fr' } });
  assert.equal(fr.body.englishNotice, null);
  // The test schema has no English template side: the French is sent.
  const en = await call(emails.previewDraft, { body: { templateId: id, language: 'en' } });
  assert.equal(en.body.englishNotice, 'Texte anglais manquant : le français sera envoyé');

  db.exec("ALTER TABLE email_templates ADD COLUMN subjectEn TEXT DEFAULT ''");
  db.exec("ALTER TABLE email_templates ADD COLUMN bodyEn TEXT DEFAULT ''");
  db.prepare("UPDATE email_templates SET subjectEn = 'See you', bodyEn = 'Hello {{clientFirstName}}. {{coffeeParagraph}}' WHERE id = ?").run(id);
  const whole = await call(emails.previewDraft, { body: { templateId: id, language: 'en' } });
  assert.equal(whole.body.englishNotice, null);
  const gap = await call(emails.previewDraft, { body: { templateId: id, language: 'en', draft: { texts: { 'text:house': { fr: 'Café offert.', en: '' } } } } });
  assert.equal(gap.body.englishNotice, 'Texte anglais manquant : phrase absente de l’email anglais');
  const access = await call(emails.previewDraft, { body: { templateId: id, language: 'en', draft: { texts: { 'access:1': { fr: 'Porte bleue.' } } } } });
  assert.equal(access.body.englishNotice, 'Texte anglais manquant : le français sera envoyé');
});

test('rule 15: « M’envoyer un test » goes to the company address, « [Test] » first, recorded nowhere', async () => {
  const { db, emails, mail, templateId } = setup();
  const res = await call(emails.sendTest, { body: { templateId: templateId('arrival_reminder_1d'), draft: { texts: { 'text:house': { fr: 'Café offert.' } } } } });
  assert.equal(res.status, 200);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'contact@lespres.fr');
  assert.match(mail.sent[0].subject, /^\[Test\] /);
  assert.match(mail.sent[0].text, /Café offert\./);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_email_sends').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n, 0);
});

test('rule 15: without SMTP the test is refused, naming Paramètres › Emails, and nothing is queued', async () => {
  const { db, emails, mail, templateId } = setup({ smtp: false });
  const res = await call(emails.sendTest, { body: { templateId: templateId('arrival_reminder_1d') } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'EMAIL_NOT_CONFIGURED');
  assert.match(res.body.message, /Paramètres › Emails/);
  assert.equal(mail.sent.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 0);
});

test('rule 15: on a development instance the test lands in the mail catcher, SMTP or not', async () => {
  const { db, templateId } = setup({ smtp: false });
  const caught = [];
  const emails = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    settingsModel: { read: () => ({ companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => false },
    testMailer: { available: () => true, send: async (m) => { caught.push(m); } },
  });
  const res = await call(emails.sendTest, { body: { templateId: templateId('arrival_reminder_1d') } });
  assert.equal(res.status, 200);
  assert.equal(caught.length, 1);
  assert.match(caught[0].subject, /^\[Test\] /);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 0);
});
