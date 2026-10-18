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

test('rule 21: the step is pre-filled from what is known, for every property', async () => {
  const { db } = setup();
  db.prepare("INSERT INTO properties (id, name, nameArticle, hasWifi) VALUES (2, 'La Cabane', 'à la', 0)").run();
  const { controller } = onboarding(db, { companyName: 'Les Prés', companyPhone: '06 12 34 56 78', companyAddress: '12 chemin des Prés' });
  const res = await call(controller.get);
  const { emails } = res.body;
  assert.equal(emails.phone, '06 12 34 56 78');
  assert.equal(emails.senderName, 'Les Prés');
  assert.equal(emails.previewStableKey, 'arrival_reminder_1d');
  assert.deepEqual(emails.properties.map((p) => [p.id, p.name, p.nameArticle, p.address, p.hasWifi]), [
    [1, 'Le Gîte', 'au', '12 chemin des Prés', true],
    // Rule 29 — an article nobody confirmed is not shown as chosen.
    [2, 'La Cabane', null, '12 chemin des Prés', false],
  ]);
  // Rule 29 — a name holding its own article offers that one, contracted.
  assert.deepEqual(emails.properties[0].articles, [{ value: 'au', label: 'au Gîte' }]);
  assert.deepEqual(emails.properties[1].articles, [{ value: 'à la', label: 'à la Cabane' }]);
});

test('rule 21: saved fields land where the emails read them; the article is then confirmed', async () => {
  const { db } = setup();
  db.prepare('UPDATE properties SET nameArticleConfirmed = 0').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'La Cabane')").run();
  const { controller, settings } = onboarding(db, { companyName: 'Les Prés', companyAddress: '1 place du Village' });
  const res = await call(controller.saveEmails, { body: {
    phone: '06 00 00 00 01', senderName: 'Claire',
    properties: [
      { id: 1, nameArticle: 'à la', address: '12 chemin des Prés', access: 'Porte bleue.', wifiName: 'Gite', wifiPassword: 'pres' },
      { id: 2, address: '1 place du Village', access: 'Clé sous le pot.' },
    ],
  } });
  assert.equal(res.status, 200);
  assert.equal(settings.companyPhone, '06 00 00 00 01');
  assert.equal(settings.smtpFromName, 'Claire');
  assert.deepEqual(db.prepare('SELECT nameArticle, nameArticleConfirmed FROM properties WHERE id = 1').get(), { nameArticle: 'à la', nameArticleConfirmed: 1 });
  const facts = arrivalFactsModel.buildModel(db).forEmail(1);
  assert.equal(facts.address, '12 chemin des Prés');
  assert.equal(facts.accessFr, 'Porte bleue.');
  assert.equal(facts.wifiPassword, 'pres');
  // The company address left as offered stays derived: not copied onto the property.
  assert.equal(arrivalFactsModel.buildModel(db).forEmail(2).address, '');
  assert.equal(arrivalFactsModel.buildModel(db).forEmail(2).accessFr, 'Clé sous le pot.');
});

test('rule 21: every field may be skipped; an unknown article is refused', async () => {
  const { db } = setup();
  const { controller, settings } = onboarding(db);
  const skipped = await call(controller.saveEmails, { body: {} });
  assert.equal(skipped.status, 200);
  assert.equal(settings.companyPhone, '06 12 34 56 78');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_arrival_facts').get().n, 0);
  const refused = await call(controller.saveEmails, { body: { properties: [{ id: 1, nameArticle: 'dans le' }] } });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.errors['properties.0.nameArticle'], 'Article inconnu');
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
