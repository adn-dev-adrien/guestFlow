// specs/cancellation-insurance.md §3.1 rule 2 and §3.2 rule 14 (spec review of 2026-10-27, agent 3 F6) —
// the insurance is not deletable (DELETE answered 200 and archived it, where the breakfast auto option
// answers 409), and a percentage carries at most 2 decimals (4.333 was accepted).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Module = require('module');

const optionsModel = require('../models/optionsModel');
const { offerInsurance, withdrawInsurance } = require('./insuranceOfferFixture');

test.before(() => offerInsurance());
test.after(() => withdrawInsurance());

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

function buildController(calls) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/optionsModel') {
      return {
        create: (p) => { calls.push(['create', p]); return { id: 1 }; },
        update: (id2, p) => { calls.push(['update', p]); return { ok: true }; },
        get: (id2) => ({ id: Number(id2) }),
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

test('rule 14 — DELETE on the insurance is refused like a typed seed, and nothing is archived', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  const model = optionsModel.buildModel(db);
  const { id } = model.create({ title: 'Assurance annulation', priceType: 'percent_of_stay', price: 4, propertyIds: [1], isCancellationInsurance: true });
  assert.deepEqual(model.remove(id), { error: 'AUTO_OPTION_NON_DELETABLE', status: 409 });
  assert.equal(db.prepare('SELECT archivedAt FROM options WHERE id = ?').get(id).archivedAt, null);
  const plain = model.create({ title: 'Ménage', priceType: 'per_stay', price: 50, propertyIds: [1] });
  assert.equal(model.remove(plain.id).ok, true, 'an ordinary option is still archived');
  db.close();
});

test('rule 2 — a percentage with more than 2 decimals is refused (422), 2 decimals go through', () => {
  for (const [price, status] of [[4.333, 422], ['4.333', 422], [4.33, 200], [12.5, 200], [4, 200]]) {
    const calls = [];
    const res = fakeRes();
    buildController(calls).create({ body: { title: 'Assurance', priceType: 'percent_of_stay', price } }, res);
    assert.equal(res.statusCode, status, `price ${price}`);
    if (status === 422) {
      assert.equal(res.body.error, 'VALIDATION_FAILED');
      assert.equal(calls.length, 0, 'nothing reaches the model');
    }
  }
});
