// specs/pricing-components.md §3 rules 1 and 11 — the loader (`models/pricingInputModel.js`) is the one place the quote of a
// stay reads the database; the tourist-tax decision of the platform's stored mode is the unit's (`touristTax.js`).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../database');
const { load, resolveGlobalPlatformTaxRow } = require('../models/pricingInputModel');
const { platformCollectsTouristTax, touristTaxRemittedByOwner } = require('../utils/pricing/touristTax');
const { calculateReservationQuote } = require('../utils/pricing');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const START = addDaysToIsoDate(todayIso(), 120);
const END = addDaysToIsoDate(START, 3);


const base = (over = {}) => ({ db, propertyId: 1, startDate: START, endDate: END, adults: 2, ...over });

test('rule 11: an unknown lodging is the engine refusal, before anything else is read', () => {
  assert.deepEqual(load(base({ propertyId: 987654 })), { error: 'Logement non trouvé', status: 404 });
  assert.deepEqual(calculateReservationQuote(base({ propertyId: 987654 })), { error: 'Logement non trouvé', status: 404 });
});

test('rule 1: the loaded input carries what the pure steps used to fetch themselves', () => {
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Loader')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  const loaded = load(base());
  assert.equal(loaded.property.id, 1);
  assert.equal(typeof loaded.vatRate, 'number');
  assert.equal(loaded.vatRegime.rate, loaded.vatRate);
  assert.equal(loaded.rules.length, 1);
  assert.ok(loaded.optionsById instanceof Map && loaded.resourcesById instanceof Map);
  assert.ok(loaded.defaultOfferedOptionIds instanceof Set);
  assert.equal(loaded.billableBabyBeds, 0);
  assert.equal(typeof loaded.paymentLedger.installments, 'function');
  assert.equal(loaded.propertyId, 1, 'the caller\'s own keys travel on');
});

test('rule 1: the platform\'s stored tourist-tax mode is read once, by its name or through the iCal bridge', () => {
  assert.equal(resolveGlobalPlatformTaxRow(db, 'direct'), null);
  db.prepare("INSERT OR REPLACE INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('LoaderPlat', 1, 0)").run();
  assert.deepEqual({ ...resolveGlobalPlatformTaxRow(db, 'loaderplat') }, { c: 1, r: 0 });
  assert.deepEqual({ ...load(base({ platform: 'LoaderPlat' })).platformTaxRow }, { c: 1, r: 0 });
  assert.equal(load(base({ platform: 'unknown-platform' })).platformTaxRow, null);
});

test('rule 3: the unit decides from the stored mode; the legacy defaults of a missing row are kept', () => {
  assert.equal(platformCollectsTouristTax('direct', { c: 1, r: 1 }), false);
  assert.equal(touristTaxRemittedByOwner('direct', { c: 0, r: 1 }), true);
  assert.equal(platformCollectsTouristTax('x', null), true);
  assert.equal(touristTaxRemittedByOwner('x', null), false);
  assert.equal(platformCollectsTouristTax('x', { c: 0, r: 0 }), false);
  assert.equal(touristTaxRemittedByOwner('x', { c: 1, r: 1 }), false);
  assert.equal(touristTaxRemittedByOwner('x', { c: 1, r: 0 }), true);
});

test('rule 1: the pricing units and the engine file hold no query of their own', () => {
  const root = path.join(__dirname, '..', 'utils');
  const files = [path.join(root, 'pricing.js'), ...fs.readdirSync(path.join(root, 'pricing')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'pricing', f))];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\.prepare\(/.test(code), `${path.relative(root, file)} runs a query`);
  }
});
