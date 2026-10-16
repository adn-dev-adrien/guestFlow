// specs/guest-email-texts-made-simple.md §3.G rule 21 — the start assistant's step « Vos emails »:
// phone and sender name pre-filled, the article as a choice, the arrival facts of the first property,
// every field skippable, and the J-2 of a sample stay as its preview.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { buildController } = require('../controllers/onboardingController');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');

function onboarding(db, row = { companyName: 'Les Prés', companyPhone: '06 12 34 56 78' }) {
  const settings = { ...row };
  const settingsModel = { read: () => settings, upsert: (p) => Object.assign(settings, p) };
  const plugins = { list: (req, res) => res.json([]) };
  return { controller: buildController({ database: db, settingsModel, propertiesModel: {}, plugins }), settings };
}

test('rule 21: the step is pre-filled from what is known', async () => {
  const { db } = setup();
  db.prepare('UPDATE properties SET nameArticleConfirmed = 0').run();
  const { controller } = onboarding(db);
  const res = await call(controller.get);
  assert.deepEqual(res.body.emails, {
    phone: '06 12 34 56 78',
    senderName: 'Les Prés',
    articles: [
      { value: 'au', label: 'au Le Gîte' }, { value: 'à la', label: 'à la Le Gîte' }, { value: "à l'", label: "à l'Le Gîte" },
      { value: 'aux', label: 'aux Le Gîte' }, { value: 'à', label: 'à Le Gîte' },
    ],
    property: { id: 1, name: 'Le Gîte', nameArticle: 'au', address: '', access: '', wifiName: '', hasWifiPassword: false },
    previewStableKey: 'arrival_reminder_1d',
  });
});

test('rule 21: saved fields land where the emails read them; the article is then confirmed', async () => {
  const { db } = setup();
  db.prepare('UPDATE properties SET nameArticleConfirmed = 0').run();
  const { controller, settings } = onboarding(db);
  const res = await call(controller.saveEmails, { body: {
    phone: '06 00 00 00 01', senderName: 'Claire', nameArticle: 'à la', address: '12 chemin des Prés', access: 'Porte bleue.', wifiName: 'Gite', wifiPassword: 'pres',
  } });
  assert.equal(res.status, 200);
  assert.equal(settings.companyPhone, '06 00 00 00 01');
  assert.equal(settings.smtpFromName, 'Claire');
  assert.deepEqual(db.prepare('SELECT nameArticle, nameArticleConfirmed FROM properties WHERE id = 1').get(), { nameArticle: 'à la', nameArticleConfirmed: 1 });
  const facts = arrivalFactsModel.buildModel(db).forEmail(1);
  assert.equal(facts.address, '12 chemin des Prés');
  assert.equal(facts.accessFr, 'Porte bleue.');
  assert.equal(facts.wifiPassword, 'pres');
});

test('rule 21: every field may be skipped; an unknown article is refused', async () => {
  const { db } = setup();
  const { controller, settings } = onboarding(db);
  const skipped = await call(controller.saveEmails, { body: {} });
  assert.equal(skipped.status, 200);
  assert.equal(settings.companyPhone, '06 12 34 56 78');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_arrival_facts').get().n, 0);
  const refused = await call(controller.saveEmails, { body: { nameArticle: 'dans le' } });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.errors.nameArticle, 'Article inconnu');
});

test('rule 21: the step previews the J-2 of a sample stay, with what is being typed', async () => {
  const { db, emails } = setup({ withStay: false });
  const res = await call(emails.previewDraft, { body: {
    stableKey: 'arrival_reminder_1d', reservationId: 'sample',
    draft: { arrival: { 1: { address: '12 chemin des Prés' } }, properties: { 1: { nameArticle: 'à la' } } },
  } });
  assert.equal(res.body.sample, true);
  assert.match(res.body.body, /vous serez à la Le Gîte/);
  assert.match(res.body.body, /- Adresse : 12 chemin des Prés/);
  assert.equal(db.prepare('SELECT nameArticle FROM properties WHERE id = 1').get().nameArticle, 'au');
});
