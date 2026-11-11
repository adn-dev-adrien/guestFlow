// specs/guest-email-texts-made-simple.md rule 29 (2026-10-18) — the start assistant reopened edits the
// price of the rule it created, never the seasons the owner added since.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');
const propertiesModelModule = require('../models/propertiesModel');

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

function setup() {
  const db = freshDb();
  applyProductisationSchema(db);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  let row = { companyName: 'Les Cabanes' };
  const settingsModel = { read: () => row, upsert: (p) => { row = { ...row, ...p }; } };
  const controller = buildController({ database: db, settingsModel, propertiesModel: propertiesModelModule.buildModel(db), plugins: { list: (req, res) => res.json([]) } });
  return { db, controller };
}

const PROPERTY = { name: 'Le Fournil', doubleBeds: '1', singleBeds: '0', maxGuests: '2', checkIn: '16:00', checkOut: '10:00', pricePerNight: '95' };

function addSeason(db, propertyId, price) {
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (?, 'Haute saison', ?, 'fixed', '[]', '[]', '#d32f2f', '2027-07-01', '2027-08-31', 1)`).run(propertyId, price);
}

const prices = (db, id) => db.prepare('SELECT label, pricePerNight FROM pricing_rules WHERE propertyId = ? ORDER BY id').all(id).map((r) => [r.label, r.pricePerNight]);

test('rule 29: « Suivant » on an untouched step 2 leaves a season added since as it is', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  addSeason(db, id, 180);
  const step = (await call(controller.get, {})).body.property;
  assert.equal(step.draft.pricePerNight, '95');
  const again = await call(controller.saveProperty, { body: { ...PROPERTY, pricePerNight: step.draft.pricePerNight } });
  assert.equal(again.status, 200);
  assert.deepEqual(prices(db, id), [['Tarif annuel', 95], ['Haute saison', 180]]);
});

test('rule 29: a new price at step 2 changes the assistant rule only', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  addSeason(db, id, 180);
  await call(controller.saveProperty, { body: { ...PROPERTY, pricePerNight: '110' } });
  assert.deepEqual(prices(db, id), [['Tarif annuel', 110], ['Haute saison', 180]]);
  assert.equal((await call(controller.get, {})).body.property.draft.pricePerNight, '110');
});

test('rule 29: a season cheaper than the assistant rule does not become the step price', async () => {
  const { db, controller } = setup();
  const { body: { id } } = await call(controller.saveProperty, { body: PROPERTY });
  addSeason(db, id, 60);
  assert.equal((await call(controller.get, {})).body.property.draft.pricePerNight, '95');
});
