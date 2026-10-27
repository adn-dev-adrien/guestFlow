// specs/guest-email-texts-made-simple.md rules 28–32 — the start assistant on a fresh instance:
// rule 28 nothing is asserted to a guest that the owner did not say (deposit, cleaning, towels, bed linen),
// rule 29 its property is edited, never created twice, rule 30 the article comes from the name,
// rule 31 the sample stay keeps the property's times, rule 32 the key-box code has its own field.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedClient, seedReservation } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');
const { buildController: buildReadiness } = require('../controllers/emailReadinessController');
const propertiesModelModule = require('../models/propertiesModel');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');
const emailTextsModel = require('../models/emailTextsModel');
const emailTextsCsv = require('../utils/emailTextsCsv');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const propertyArticle = require('../utils/propertyArticle');
const { pendingFactsOf } = require('../utils/propertyFacts');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    Promise.resolve(handler({ body: {}, params: {}, query: {}, ...req }, res));
  });
}

const FULL = { companyName: 'Les Cabanes', companyPhone: '06 12 34 56 78', smtpFromName: 'Claire', companyAddress: '1 place du Lac' };

function setup() {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = { ...FULL };
  const settingsModel = { read: () => row, upsert: (p) => { row = { ...row, ...p }; } };
  const propertiesModel = propertiesModelModule.buildModel(db);
  const plugins = { list: (req, res) => res.json([]) };
  const controller = buildController({ database: db, settingsModel, propertiesModel, plugins });
  return { db, controller, settingsModel };
}

const PROPERTY = { name: 'Le Fournil', doubleBeds: '1', singleBeds: '1', maxGuests: '3', checkIn: '16:30', checkOut: '11:00', pricePerNight: '95' };

function render(db, propertyId, stableKey) {
  if (!db.prepare('SELECT 1 FROM clients WHERE id = 1').get()) seedClient(db, { id: 1 });
  const id = seedReservation(db, { propertyId, startDate: '2027-07-10', endDate: '2027-07-14', checkInTime: '16:30', checkOutTime: '11:00' });
  const graph = loadReservationGraph(db, id);
  const template = db.prepare('SELECT * FROM email_templates WHERE stableKey = ?').get(stableKey);
  const context = buildContext({ ...graph, settings: FULL, lang: 'fr', sequence: { lastMinute: false } });
  return renderTemplate({ subject: template.subject, body: template.body }, context);
}

test('rule 28: a property made by the assistant has no deposit and four facts left unsaid', async () => {
  const { db, controller } = setup();
  const res = await call(controller.saveProperty, { body: PROPERTY });
  assert.equal(res.status, 200);
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(res.body.id);
  assert.equal(Number(p.defaultCautionAmount), 0);
  assert.deepEqual([...pendingFactsOf(p)], ['caution', 'cleaning', 'towels', 'linen']);
  const j2 = render(db, p.id, 'arrival_reminder_1d').body;
  assert.doesNotMatch(j2, /caution/i);
  assert.doesNotMatch(j2, /ménage/i);
  const j7 = render(db, p.id, 'arrival_reminder_7d').body;
  assert.doesNotMatch(j7, /serviettes/i);
});

test('rule 28: what is still unsaid is listed, and answering it in « Vos emails » brings the sentences back', async () => {
  const { db, controller, settingsModel } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  const readiness = () => buildReadiness({ database: db, settingsModel }).compute().items.map((i) => i.id);
  for (const fact of ['caution', 'cleaning', 'towels', 'linen']) assert.ok(readiness().includes(`property.${fact}:${id}`), fact);

  const saved = await call(controller.saveEmails, { body: { properties: [{ id, caution: '300', cleaningIncluded: false, towelsProvided: false, bedLinenProvided: false }] } });
  assert.equal(saved.status, 200);
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  assert.equal(p.defaultCautionAmount, 300);
  assert.equal(p.pendingFacts, '');
  assert.ok(!readiness().some((i) => /^property\.(caution|cleaning|towels|linen):/.test(i)));
  const j2 = render(db, id, 'arrival_reminder_1d').body;
  assert.match(j2, /caution de 300 €/);
  assert.match(j2, /ménage/i);
  const emails = (await call(controller.get, {})).body.emails.properties[0];
  assert.deepEqual([emails.caution, emails.cleaningIncluded, emails.towelsProvided, emails.bedLinenProvided, emails.pending], [300, false, false, false, []]);
});

test('rule 28: an untouched step answers nothing; a negative deposit is refused', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  await call(controller.saveEmails, { body: { properties: [{ id, address: '1 place du Lac' }] } });
  assert.equal(db.prepare('SELECT pendingFacts FROM properties WHERE id = ?').get(id).pendingFacts, 'caution,cleaning,towels,linen');
  const refused = await call(controller.saveEmails, { body: { properties: [{ id, caution: '-5' }] } });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.errors['properties.0.caution'], 'Un montant ≥ 0 €');
});

test('rule 28: a property that existed before keeps every sentence (nothing pending)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO properties (id, name, nameArticle, defaultCautionAmount) VALUES (1, 'La Granja', 'à', 400)").run();
  const p = db.prepare('SELECT * FROM properties WHERE id = 1').get();
  assert.equal(p.pendingFacts, '');
  assert.match(render(db, 1, 'arrival_reminder_1d').body, /caution de 400 €/);
});

test('rule 28: saving the property page answers only the facts it sends', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  const model = propertiesModelModule.buildModel(db);
  await model.update(id, { name: 'Le Fournil', parkingDistanceMeters: 0, cleaningIncluded: 'options' });
  assert.equal(db.prepare('SELECT pendingFacts FROM properties WHERE id = ?').get(id).pendingFacts, 'caution,towels,linen');
  await model.update(id, { name: 'Le Fournil', defaultCautionAmount: 0, towelsProvided: '1', bedLinenProvided: '1' });
  const p = db.prepare('SELECT pendingFacts, towelsProvided, cleaningIncluded FROM properties WHERE id = ?').get(id);
  assert.deepEqual({ ...p }, { pendingFacts: '', towelsProvided: 1, cleaningIncluded: null });
});

test('rule 29: « Précédent » then « Suivant », or the assistant reopened, edits its property', async () => {
  const { db, controller } = setup();
  const first = await call(controller.saveProperty, { body: PROPERTY });
  const again = await call(controller.saveProperty, { body: { ...PROPERTY, name: 'La Bergerie', pricePerNight: '120' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 1);
  assert.equal(db.prepare('SELECT name FROM properties').get().name, 'La Bergerie');
  assert.equal(db.prepare('SELECT pricePerNight FROM pricing_rules WHERE propertyId = ?').get(first.body.id).pricePerNight, 120);
  const { property } = (await call(controller.get, {})).body;
  assert.equal(property.id, first.body.id);
  assert.equal(property.draft.name, 'La Bergerie');
  assert.equal(property.draft.checkIn, '16:30');
});

test('rule 29: an instance that already has properties gets none from the assistant', async () => {
  const { db, controller } = setup();
  db.prepare("INSERT INTO properties (name) VALUES ('Gite'), ('Aventura lodge')").run();
  const res = await call(controller.saveProperty, { body: PROPERTY });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'PROPERTIES_EXIST');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 2);
  assert.deepEqual((await call(controller.get, {})).body.property, { id: null, existing: 2, draft: null });
});

test('rule 30: the article follows the name; no « à l\'Gite », no « au Le Fournil »', () => {
  assert.deepEqual(propertyArticle.derive('Le Fournil'), { article: 'au', certain: true });
  assert.deepEqual(propertyArticle.derive('La Bergerie'), { article: 'à la', certain: true });
  assert.deepEqual(propertyArticle.derive('Les Pins'), { article: 'aux', certain: true });
  assert.deepEqual(propertyArticle.derive("L'Oustal"), { article: "à l'", certain: true });
  assert.deepEqual(propertyArticle.derive('Estiva'), { article: "à l'", certain: false });
  assert.deepEqual(propertyArticle.derive('Gite'), { article: 'au', certain: false });
  assert.equal(propertyArticle.format('Le Fournil', 'au'), 'au Fournil');
  assert.equal(propertyArticle.format('La Bergerie', 'à la'), 'à la Bergerie');
  assert.equal(propertyArticle.format('Les Pins', 'aux'), 'aux Pins');
  assert.equal(propertyArticle.format("L'Oustal", "à l'"), "à l'Oustal");
  assert.equal(propertyArticle.format('La Granja', 'à'), 'à La Granja');
  assert.equal(propertyArticle.format('Le Fournil', 'au', 'en'), 'Le Fournil');
  assert.deepEqual(propertyArticle.choices('Gite').map((c) => c.label), ['au Gite', 'à la Gite', 'aux Gite', 'à Gite']);
  assert.ok(!propertyArticle.choices('Gite').some((c) => c.label === "à l'Gite"));
  assert.deepEqual(propertyArticle.choices('Le Fournil'), [{ value: 'au', label: 'au Fournil' }]);
});

test('rule 30: a name holding its article is confirmed at once; any other one is left to choose', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  assert.deepEqual({ ...db.prepare('SELECT nameArticle, nameArticleConfirmed FROM properties WHERE id = ?').get(id) }, { nameArticle: 'au', nameArticleConfirmed: 1 });
  assert.match(render(db, id, 'arrival_reminder_7d').subject, /votre séjour au Fournil$/);

  const other = setup();
  const created = await call(other.controller.saveProperty, { body: { ...PROPERTY, name: 'Gite' } });
  assert.equal(other.db.prepare('SELECT nameArticleConfirmed FROM properties WHERE id = ?').get(created.body.id).nameArticleConfirmed, 0);
  const step = (await call(other.controller.get, {})).body.emails.properties[0];
  assert.equal(step.nameArticle, null);
  const readiness = buildReadiness({ database: other.db, settingsModel: other.settingsModel }).compute().items.map((i) => i.id);
  assert.ok(readiness.includes(`property.article:${created.body.id}`));
});

test('rule 33: the neutral J-7 subject names the stay with its article', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: { ...PROPERTY, name: 'La Bergerie' } });
  assert.equal(render(db, id, 'arrival_reminder_7d').subject, 'Plus qu\'une semaine avant votre séjour à la Bergerie');
});

test('rule 31: the sample stay of the preview arrives and leaves at the property\'s own times', async () => {
  const { db, controller } = setup();
  await call(controller.saveProperty, { body: PROPERTY });
  const { buildDraftPreview } = require('../utils/emailDraftPreview');
  let seen = null;
  const preview = buildDraftPreview({
    database: db,
    templatesModel: { findById: (tid) => db.prepare('SELECT * FROM email_templates WHERE id = ?').get(tid) },
    buildPreview: (reservationId) => {
      seen = db.prepare('SELECT checkInTime, checkOutTime FROM reservations WHERE id = ?').get(reservationId);
      return { subject: '', body: '', graph: { reservation: {} } };
    },
  });
  const tid = db.prepare("SELECT id FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get().id;
  preview.render({ templateId: tid, reservationId: 'sample', draft: {} });
  assert.deepEqual({ ...seen }, { checkInTime: '16:30', checkOutTime: '11:00' });
});

test('rule 32: the code typed in « Vos emails » is kept apart, encrypted, and never in the file', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  await call(controller.saveEmails, { body: { properties: [{ id, access: 'Boîte à clés à gauche de la porte.', accessCode: '4821' }] } });
  const facts = arrivalFactsModel.buildModel(db).forEmail(id);
  assert.equal(facts.accessCode, '4821');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM property_arrival_facts').all()).includes('4821'));
  assert.equal((await call(controller.get, {})).body.emails.properties[0].hasAccessCode, true);
  const csv = emailTextsCsv.serialise(emailTextsModel.buildModel(db).all());
  assert.doesNotMatch(csv, /4821|Boîte à clés|access:/);
});
