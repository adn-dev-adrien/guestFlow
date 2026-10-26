// specs/google-vacation-rentals-feed.md rule 12 — the core announces `pricing.changed { propertyId | null,
// source }` once after every write that can move a price, a minimum stay, a changeover day or a closed
// night, and never after a refused write. Real controllers over the real schema in memory.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const db = require('../database');
console.log = silent;
const eventBus = require('../plugins/sdk/eventBus');
const properties = require('../controllers/propertiesController');
const optionDefaults = require('../controllers/propertyOptionDefaultsController');
const closures = require('../controllers/establishmentClosuresController');
const options = require('../controllers/optionsController');
const { createController: createRecipeController } = require('../plugins/tariff-recipes/controller');
const { runTariffRecipeHorizonPass } = require('../plugins/tariff-recipes/horizon');
const { createContext } = require('../plugins/sdk/createContext');
const registry = require('../plugins/sdk/registry');

let emitted = [];
const original = eventBus.emit;
eventBus.emit = (name, payload) => { emitted.push([name, payload]); };
test.after(() => { eventBus.emit = original; });

function res() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

const priced = () => emitted.filter(([name]) => name === 'pricing.changed').map(([, payload]) => payload);

function property(name) {
  return Number(db.prepare("INSERT INTO properties (name, maxGuests, basePriceIncludedGuests) VALUES (?, 6, 2)").run(name).lastInsertRowid);
}
const p1 = property('Gîte');
const p2 = property('Tente');
const optionId = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Draps', 10, 'per_stay')").run().lastInsertRowid);

test.beforeEach(() => { emitted = []; });

test('pricing rules: add, update, delete announce the property once', () => {
  const add = res();
  properties.addPricing({ params: { id: String(p1) }, body: { label: 'Été', pricePerNight: 120, startDate: '2027-06-01', endDate: '2027-08-31' } }, add);
  assert.equal(add.statusCode, 200);
  const ruleId = add.body.id;
  properties.updatePricing({ params: { id: String(p1), ruleId: String(ruleId) }, body: { label: 'Été', pricePerNight: 130, startDate: '2027-06-01', endDate: '2027-08-31' } }, res());
  properties.deletePricing({ params: { id: String(p1), ruleId: String(ruleId) } }, res());
  assert.deepEqual(priced(), [
    { propertyId: p1, source: 'pricing' }, { propertyId: p1, source: 'pricing' }, { propertyId: p1, source: 'pricing' },
  ]);
});

test('a refused pricing write announces nothing', () => {
  const ok = res();
  properties.addPricing({ params: { id: String(p1) }, body: { label: 'A', pricePerNight: 100, startDate: '2028-01-01', endDate: '2028-01-31' } }, ok);
  emitted = [];
  const refused = res();
  properties.addPricing({ params: { id: String(p1) }, body: { label: 'B', pricePerNight: 100, startDate: '2028-01-15', endDate: '2028-02-15' } }, refused);
  assert.ok(refused.statusCode >= 400, 'the overlapping season is refused');
  const bad = res();
  properties.assignPricingDateRange({ params: { id: String(p1) }, body: { startDate: 'x', endDate: 'y', minNights: 2, target: { mode: 'new' } } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(priced(), []);
});

test('apply-to announces the TARGET property; assign-dates the property painted', () => {
  properties.applyPricing({ params: { id: String(p1) }, body: { targetPropertyId: p2, replaceExisting: true } }, res());
  assert.deepEqual(priced(), [{ propertyId: p2, source: 'pricing' }]);
  emitted = [];
  const rule = db.prepare('SELECT id FROM pricing_rules WHERE propertyId = ? LIMIT 1').get(p1);
  const painted = res();
  properties.assignPricingDateRange({ params: { id: String(p1) }, body: { startDate: '2028-01-10', endDate: '2028-01-12', minNights: 2, target: { mode: 'existing', ruleId: rule.id } } }, painted);
  assert.equal(painted.statusCode, 200, JSON.stringify(painted.body));
  assert.deepEqual(priced(), [{ propertyId: p1, source: 'pricing' }]);
});

test('a property update announces only when a price-bearing field moved', async () => {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(p1);
  const body = { ...row, name: 'Gîte renommé' };
  await properties.update({ params: { id: String(p1) }, body }, res());
  assert.deepEqual(priced(), [], 'a new name moves no price');
  await properties.update({ params: { id: String(p1) }, body: { ...body, extraGuestPrice: 25 } }, res());
  await properties.update({ params: { id: String(p1) }, body: { ...body, extraGuestPrice: 25, touristTaxPerDayPerPerson: 1.5 } }, res());
  assert.deepEqual(priced(), [{ propertyId: p1, source: 'property' }, { propertyId: p1, source: 'property' }]);
});

test('the options of a property and its option defaults announce the property', () => {
  properties.setOptions({ params: { id: String(p1) }, body: { optionIds: [optionId] } }, res());
  optionDefaults.setForProperty({ params: { id: String(p1), optionId: String(optionId) }, body: { offered: false } }, res());
  optionDefaults.unsetForProperty({ params: { id: String(p1), optionId: String(optionId) } }, res());
  assert.deepEqual(priced(), [
    { propertyId: p1, source: 'options' }, { propertyId: p1, source: 'option-defaults' }, { propertyId: p1, source: 'option-defaults' },
  ]);
  emitted = [];
  optionDefaults.setForProperty({ params: { id: 'x', optionId: String(optionId) }, body: {} }, res());
  assert.deepEqual(priced(), [], 'an invalid id is refused before any write');
});

test('the shared option catalogue announces every property (null)', () => {
  options.update({ params: { id: String(optionId) }, body: { title: 'Draps', price: 12, priceType: 'per_stay' } }, res());
  assert.deepEqual(priced(), [{ propertyId: null, source: 'options' }]);
  emitted = [];
  options.update({ params: { id: '99999' }, body: { title: 'x' } }, res());
  assert.deepEqual(priced(), [], 'an unknown option is refused');
});

test('closures: a property closure announces its property, an establishment-wide one null', () => {
  const own = res();
  closures.create({ body: { propertyId: p1, startDate: '2029-01-01', endDate: '2029-01-10', label: 'Travaux' } }, own);
  const all = res();
  closures.create({ body: { propertyId: null, startDate: '2029-02-01', endDate: '2029-02-05' } }, all);
  assert.deepEqual(priced(), [{ propertyId: p1, source: 'closures' }, { propertyId: null, source: 'closures' }]);
  emitted = [];
  closures.update({ params: { id: String(own.body.id) }, body: { propertyId: p2, startDate: '2029-01-01', endDate: '2029-01-10' } }, res());
  assert.deepEqual(priced(), [{ propertyId: p2, source: 'closures' }, { propertyId: p1, source: 'closures' }], 'moved: both properties');
  emitted = [];
  closures.delete({ params: { id: String(all.body.id) } }, res());
  assert.deepEqual(priced(), [{ propertyId: null, source: 'closures' }]);
  emitted = [];
  closures.create({ body: { propertyId: p1, startDate: '2029-03-10', endDate: '2029-03-01' } }, res());
  assert.deepEqual(priced(), [], 'an inverted range is refused');
});

test('tariff-recipes: an applied recipe and an extended horizon announce the property; a no-op does not', () => {
  const announced = [];
  const announce = (id) => announced.push(Number(id));
  let next = { applied: true };
  const controller = createRecipeController({ db, store: () => ({}), model: () => ({ apply: () => next }), properties: () => ({}), journal: () => ({}), announce });
  controller.applyToProperty({ params: { id: String(p1) }, body: { recipeId: 'gite-2027' } }, res());
  next = { applied: false };
  controller.applyToProperty({ params: { id: String(p1) }, body: { recipeId: 'gite-2027' } }, res());
  next = { blocking: true, warnings: ['x'] };
  controller.applyToProperty({ params: { id: String(p1) }, body: { recipeId: 'gite-2027' } }, res());
  assert.deepEqual(announced, [p1]);

  const fakeDb = { prepare: () => ({ all: () => [{ id: p2, name: 'Tente', tariffRecipeId: 'r' }] }) };
  const model = { listPendingRuns: () => [], coveredUntilYear: () => null, apply: () => ({ applied: true }), recordRun: () => {} };
  const quiet = console.log;
  console.log = () => {};
  try {
    runTariffRecipeHorizonPass('test', { model, store: { getRecipe: () => ({ id: 'r', version: '1', horizonYears: 2 }) }, database: fakeDb, announce });
  } finally { console.log = quiet; }
  assert.deepEqual(announced, [p1, p2]);
});

test('ctx.events.emit: a plugin may announce pricing.changed, never a reservation event', () => {
  registry.reset();
  const ctx = createContext('tariff-recipes', { db, settingsModel: () => ({}) });
  ctx.events.emit('pricing.changed', { propertyId: p1, source: 'tariff-recipes' });
  assert.deepEqual(priced(), [{ propertyId: p1, source: 'tariff-recipes' }]);
  assert.throws(() => ctx.events.emit('reservation.created', { reservationId: 1 }), /may not emit/);
  assert.ok(eventBus.EVENTS.includes('pricing.changed'));
});
