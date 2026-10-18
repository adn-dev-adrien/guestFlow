// specs/guest-email-texts-made-simple.md rule 27 (2026-10-18) — the bed linen is a fact like the
// towels: after the start assistant nothing is said of it (no « pensez à prendre draps » from the
// option created at install) until the owner answers, on the property page or in « Vos emails ».

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedClient, seedReservation } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');
const { buildController: buildReadiness } = require('../controllers/emailReadinessController');
const propertiesModelModule = require('../models/propertiesModel');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');

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
  const controller = buildController({ database: db, settingsModel, propertiesModel: propertiesModelModule.buildModel(db), plugins: { list: (req, res) => res.json([]) } });
  return { db, controller, settingsModel };
}

const PROPERTY = { name: 'Le Fournil', doubleBeds: '1', singleBeds: '0', maxGuests: '2', checkIn: '16:00', checkOut: '10:00', pricePerNight: '95' };

function j7(db, propertyId) {
  if (!db.prepare('SELECT 1 FROM clients WHERE id = 1').get()) seedClient(db, { id: 1 });
  const id = seedReservation(db, { propertyId, doubleBeds: 1, startDate: '2027-07-10', endDate: '2027-07-14' });
  const template = db.prepare("SELECT * FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  const context = buildContext({ ...loadReservationGraph(db, id), settings: FULL, lang: 'fr', sequence: { lastMinute: false } });
  return renderTemplate({ subject: template.subject, body: template.body }, context).body;
}

test('rule 27: the J-7 of an assistant property says nothing of the bed linen, and it is listed to complete', async () => {
  const { db, controller, settingsModel } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  const body = j7(db, id);
  assert.doesNotMatch(body, /linge de lit|draps|lits seront/i);
  const items = buildReadiness({ database: db, settingsModel }).compute().items;
  const linen = items.find((i) => i.id === `property.linen:${id}`);
  assert.ok(linen);
  assert.equal(linen.section, 'j7');
});

test('rule 27: answered « à apporter » in « Vos emails », the J-7 asks for sheets again', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  await call(controller.saveEmails, { body: { properties: [{ id, bedLinenProvided: false }] } });
  assert.match(j7(db, id), /draps/);
  assert.equal(db.prepare('SELECT bedLinenProvided FROM properties WHERE id = ?').get(id).bedLinenProvided, 0);
});

test('rule 27: answered « fourni » on the property page, the J-7 says the beds are made', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  await propertiesModelModule.buildModel(db).update(id, { name: 'Le Fournil', bedLinenProvided: '1' });
  assert.doesNotMatch(db.prepare('SELECT pendingFacts FROM properties WHERE id = ?').get(id).pendingFacts, /linen/);
  assert.match(j7(db, id), /Nous préparerons les lits ainsi : 1 lit double/);
  assert.doesNotMatch(j7(db, id), /draps/);
});

test('rule 27: a property that existed before keeps its linen sentence (nothing pending)', () => {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare("INSERT INTO properties (id, name, nameArticle, doubleBeds) VALUES (1, 'La Granja', 'à', 1)").run();
  assert.match(j7(db, 1), /draps/);
});
