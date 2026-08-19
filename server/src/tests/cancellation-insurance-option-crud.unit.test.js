// specs/cancellation-insurance.md §3.1 rule 2 + §3.2 rules 11-12, 15 — persisting the flag
// (exclusive, guarded), resolving THE insurance of a property, and rejecting an out-of-range
// percentage at the API boundary.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Module = require('module');

const optionsModel = require('../models/optionsModel');

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, priceType TEXT, price REAL,
    optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
    linenIncludesSingle INTEGER NOT NULL DEFAULT 1, linenIncludesDouble INTEGER NOT NULL DEFAULT 1,
    linenIncludesBaby INTEGER NOT NULL DEFAULT 1, towelLargePerPerson INTEGER NOT NULL DEFAULT 1,
    towelMediumPerPerson INTEGER NOT NULL DEFAULT 0, towelSmallPerPerson INTEGER NOT NULL DEFAULT 1,
    archivedAt TEXT, isCancellationInsurance INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: optionsModel.buildModel(db) };
}

const flag = (db, id) => db.prepare('SELECT isCancellationInsurance AS f FROM options WHERE id = ?').get(id).f;

test('the flag is exclusive — marking a second option clears the first', () => {
  const { db, model } = freshModel();
  const a = model.create({ title: 'Assurance annulation', priceType: 'percent_of_stay', price: 4, propertyIds: [1], isCancellationInsurance: true });
  const b = model.create({ title: 'Garantie annulation', priceType: 'per_stay', price: 25, propertyIds: [1], isCancellationInsurance: true });
  assert.equal(flag(db, a.id), 0, 'the previous one is demoted, not duplicated');
  assert.equal(flag(db, b.id), 1);
  db.close();
});

test('a payload that says nothing about the flag leaves it alone', () => {
  const { db, model } = freshModel();
  const { id } = model.create({ title: 'Assurance annulation', priceType: 'percent_of_stay', price: 4, propertyIds: [1], isCancellationInsurance: true });
  // A caller unaware of the flag (an older client, the SAS path) must not silently clear it.
  model.update(id, { title: 'Assurance annulation', priceType: 'percent_of_stay', price: 5, propertyIds: [1] });
  assert.equal(flag(db, id), 1);
  assert.equal(model.get(id).price, 5);

  model.update(id, { title: 'Assurance annulation', priceType: 'percent_of_stay', price: 5, propertyIds: [1], isCancellationInsurance: false });
  assert.equal(flag(db, id), 0, 'an explicit false does clear it');
  db.close();
});

test('getCancellationInsurance resolves THE insurance of a property, with its effective percentage', () => {
  const { db, model } = freshModel();
  const { id } = model.create({
    title: 'Assurance annulation', priceType: 'percent_of_stay', price: 4,
    propertyIds: [1, 2], isCancellationInsurance: true,
    perPropertyPricing: true, propertyPrices: { 2: 6 },
  });
  assert.equal(model.getCancellationInsurance(1).id, id);
  assert.equal(model.getCancellationInsurance(1).price, 4);
  assert.equal(model.getCancellationInsurance(2).price, 6, 'the per-property percentage wins');
  assert.equal(model.getCancellationInsurance(3), null, 'not applicable to that property');
  db.close();
});

test('an unpriced insurance resolves to null — 0 % is not an offer', () => {
  const { db, model } = freshModel();
  model.create({ title: 'Assurance annulation', priceType: 'percent_of_stay', price: 0, propertyIds: [1], isCancellationInsurance: true });
  assert.equal(model.getCancellationInsurance(1), null);
  db.close();
});

// ------------------------------------------------------------------ controller

function buildController(calls) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/optionsModel') {
      return {
        create: (p) => { calls.push(['create', p]); return { id: 1 }; },
        update: (id2, p) => { calls.push(['update', p]); return { ok: true }; },
      };
    }
    return origRequire.call(this, id);
  };
  try {
    const m = '../controllers/optionsController';
    delete require.cache[require.resolve(m)];
    return require(m);
  } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('a percentage outside 0-100 is refused — the client input is a hint, this is the guard', () => {
  for (const price of [-1, 101, 'abc']) {
    const calls = [];
    const res = fakeRes();
    buildController(calls).create({ body: { title: 'Assurance', priceType: 'percent_of_stay', price } }, res);
    assert.equal(res.statusCode, 422, `price ${price} must be rejected`);
    assert.equal(res.body.error, 'VALIDATION_FAILED');
    assert.equal(calls.length, 0, 'nothing reaches the model');
  }
});

test('a valid percentage goes through, and other price types are untouched by the check', () => {
  const calls = [];
  const controller = buildController(calls);
  const res = fakeRes();
  controller.create({ body: { title: 'Assurance', priceType: 'percent_of_stay', price: 4 } }, res);
  assert.equal(res.statusCode, 200);

  controller.update({ params: { id: '1' }, body: { title: 'Ménage', priceType: 'per_stay', price: 480 } }, fakeRes());
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'update'], '480 € of ménage is not a percentage');
});
