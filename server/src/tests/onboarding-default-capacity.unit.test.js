// specs/plugins-phase-p-productisation.md §3.D rule 21 (2026-10-23) — the capacity the start assistant
// proposes is the server's: two per double bed, one per single bed, within 1–50; a property saved
// without a capacity takes it.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { applyProductisationSchema } = require('../utils/productisationMigration');
const { buildController } = require('../controllers/onboardingController');
const propertiesModelModule = require('../models/propertiesModel');
const { defaultCapacity, MAX_CAPACITY } = require('../utils/defaultCapacity');

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

test('two per double bed, one per single bed, numbers or strings', () => {
  assert.equal(defaultCapacity(1, 0), 2);
  assert.equal(defaultCapacity('2', '3'), 7);
  assert.equal(defaultCapacity(' 1 ', '1'), 3);
});

test('a count still being typed counts as no bed', () => {
  assert.equal(defaultCapacity('', '2'), 2);
  assert.equal(defaultCapacity(undefined, null), 1);
  assert.equal(defaultCapacity('-1', '3'), 3);
  assert.equal(defaultCapacity('1.5', '1'), 1);
  assert.equal(defaultCapacity('deux', '1'), 1);
  assert.equal(defaultCapacity(['3'], { n: 2 }), 1);
});

test('kept within 1 and MAX_CAPACITY', () => {
  assert.equal(MAX_CAPACITY, 50);
  assert.equal(defaultCapacity('0', '0'), 1);
  assert.equal(defaultCapacity('30', '0'), 50);
  assert.equal(defaultCapacity('1e9', '1'), 50);
  assert.equal(defaultCapacity(String(Number.MAX_SAFE_INTEGER * 10), '0'), 50);
  assert.equal(defaultCapacity('Infinity', '0'), 1);
});

test('GET /api/onboarding/default-capacity answers { maxGuests }', async () => {
  const { controller } = setup();
  assert.deepEqual((await call(controller.defaultCapacity, { query: { doubleBeds: '2', singleBeds: '1' } })).body, { maxGuests: 5 });
  assert.deepEqual((await call(controller.defaultCapacity, { query: {} })).body, { maxGuests: 1 });
  assert.deepEqual((await call(controller.defaultCapacity, { query: { doubleBeds: '40' } })).body, { maxGuests: 50 });
});

test('a property saved without a capacity takes the one its beds propose', async () => {
  const base = { name: 'Le Fournil', doubleBeds: '2', singleBeds: '1', checkIn: '16:00', checkOut: '10:00', pricePerNight: '95' };
  for (const maxGuests of [undefined, null, '', '  ']) {
    const { db, controller } = setup();
    const res = await call(controller.saveProperty, { body: { ...base, maxGuests } }); // eslint-disable-line no-await-in-loop
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(db.prepare('SELECT maxGuests FROM properties WHERE id = ?').get(res.body.id).maxGuests, 5);
  }
});

test('a capacity typed by hand is kept, and still validated', async () => {
  const base = { name: 'Le Fournil', doubleBeds: '2', singleBeds: '1', checkIn: '16:00', checkOut: '10:00', pricePerNight: '95' };
  const { db, controller } = setup();
  const res = await call(controller.saveProperty, { body: { ...base, maxGuests: '3' } });
  assert.equal(db.prepare('SELECT maxGuests FROM properties WHERE id = ?').get(res.body.id).maxGuests, 3);
  const refused = await call(setup().controller.saveProperty, { body: { ...base, maxGuests: '0' } });
  assert.equal(refused.status, 422);
  assert.ok(refused.body.errors.maxGuests);
});
