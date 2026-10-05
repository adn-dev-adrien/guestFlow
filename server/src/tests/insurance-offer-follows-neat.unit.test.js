// specs/plugins-phase-3b-neat.md rules 6, 21–22 (decision P13) — without an active Neat the cancellation
// insurance leaves every option list, the site included, and cannot be made again; a stay that carries
// it gets it back read-only; the plugin's return brings the option back with its settings.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/optionsModel');
const insuranceOffer = require('../utils/insuranceOffer');
const { offerInsurance, withdrawInsurance } = require('./insuranceOfferFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, isCancellationInsurance) VALUES (10, 'Assurance annulation', 'percent_of_stay', 4, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (11, 'Ménage', 'per_stay', 80)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10), (1, 11)').run();
  return db;
}

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// The options controller over a model bound to the suite's database.
function controllerOn(model) {
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    return id === '../models/optionsModel' ? model : original.call(this, id);
  };
  try {
    const m = '../controllers/optionsController';
    delete require.cache[require.resolve(m)];
    return require(m);
  } finally {
    Module.prototype.require = original;
  }
}

test.beforeEach(() => withdrawInsurance());
test.after(() => withdrawInsurance());

test('rules 6, 21 — the catalogue, the property and the site lists hide the insurance; its row stays', () => {
  const db = seed();
  const model = buildModel(db);
  assert.deepEqual(model.list().map((o) => o.id), [11]);
  assert.deepEqual(model.listForProperty(1).map((o) => o.id), [11], 'the site and the fiche tiles');
  assert.equal(model.get(10), null);
  assert.equal(model.getCancellationInsurance(1, { dynamicPrice: true }), null, 'no public block, no question');
  assert.equal(db.prepare('SELECT price FROM options WHERE id = 10').get().price, 4, 'kept as configured');
});

test('rule 21 — the hidden option answers 404, and no option can become the insurance', () => {
  const db = seed();
  const controller = controllerOn(buildModel(db));
  const missing = fakeRes();
  controller.update({ params: { id: '10' }, body: { title: 'Assurance', priceType: 'percent_of_stay', price: 5 } }, missing);
  assert.equal(missing.statusCode, 404);
  for (const call of [
    (res) => controller.create({ body: { title: 'Assurance', priceType: 'per_stay', price: 10, isCancellationInsurance: true } }, res),
    (res) => controller.update({ params: { id: '11' }, body: { title: 'Ménage', priceType: 'per_stay', price: 80, isCancellationInsurance: true } }, res),
  ]) {
    const res = fakeRes();
    call(res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'L’assurance annulation demande le plugin Neat.');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options WHERE isCancellationInsurance = 1').get().n, 1);
});

test('rule 22 — a stay that carries the insurance gets it back read-only; one without it gets nothing', () => {
  const db = seed();
  const insured = Number(db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate) VALUES (1, 1, '2026-11-10', '2026-11-13')").run().lastInsertRowid);
  const bare = Number(db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate) VALUES (1, 1, '2026-12-10', '2026-12-13')").run().lastInsertRowid);
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, totalPrice) VALUES (?, 10, 1, 23, 23)").run(insured);
  const [frozen] = insuranceOffer.frozenOptions(db, insured);
  assert.equal(frozen.id, 10);
  assert.equal(frozen.readOnly, true);
  assert.equal(frozen.readOnlyReason, 'Lecture seule : plugin Neat inactif');
  assert.deepEqual(insuranceOffer.frozenOptions(db, bare), []);
  offerInsurance();
  assert.deepEqual(insuranceOffer.frozenOptions(db, insured), [], 'with Neat the tile is the ordinary one');
});

test('rules 21, 23 — Neat back: the option is back with its price, type and properties, in the Options list', () => {
  const db = seed();
  offerInsurance();
  const model = buildModel(db);
  const back = model.get(10);
  assert.equal(back.priceType, 'percent_of_stay');
  assert.equal(back.price, 4);
  assert.deepEqual(back.propertyIds, [1]);
  assert.deepEqual(model.listForProperty(1).map((o) => o.id).sort(), [10, 11]);
});

test('rule 6 — the site refuses the insurance like an option the property does not offer', () => {
  const db = seed();
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../../models/optionsModel') return buildModel(db);
    return original.call(this, id);
  };
  let quoteController;
  try {
    const m = '../plugins/website-booking/controllers/publicQuoteController';
    delete require.cache[require.resolve(m)];
    quoteController = require(m);
  } finally {
    Module.prototype.require = original;
  }
  assert.deepEqual(quoteController.checkOptionApplicability(1, [{ optionId: 10, quantity: 1 }]), [
    { field: 'options', issue: 'option 10 is not available for this property' },
  ]);
  assert.equal(quoteController.checkOptionApplicability(1, [{ optionId: 11, quantity: 1 }]), null);
  offerInsurance();
  assert.equal(quoteController.checkOptionApplicability(1, [{ optionId: 10, quantity: 1 }]), null, 'offered again with Neat');
});
