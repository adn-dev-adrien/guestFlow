// Bath-linen upsell offer for the arrival SAS (specs/sas-bath-linen-upsell.md §3.1).
// The offer prices « Linge de toilette » PER PERSON, mirroring the reservation engine
// (getTypeMultiplier on the option's own priceType), with the per-property price override.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
  `);
  return db;
}

// 2 adults + 1 teen + 1 child + 1 baby = 4 billable persons (babies excluded), 3 nights.
function reservation(overrides = {}) {
  return {
    propertyId: 7,
    adults: 2, teens: 1, children: 1, babies: 1,
    nights: [{}, {}, {}],
    options: [],
    ...overrides,
  };
}

test('offer: per-person amount = billable persons × unit price (babies excluded)', () => {
  const db = makeDb();
  db.prepare("INSERT INTO options (id, autoOptionType, price, priceType) VALUES (1, 'bathroom_linen', 6, 'per_person')").run();
  const model = createReservationsModel(db);
  const offer = model.getBathLinenOfferForReservation(reservation());
  assert.equal(offer.available, true);
  assert.equal(offer.persons, 4);        // 2 + 1 + 1, baby excluded
  assert.equal(offer.unitPrice, 6);
  assert.equal(offer.amount, 24);        // 4 × 6
  assert.equal(offer.label, 'Linge de toilette');
});

test('offer: per-property price override wins over the base price', () => {
  const db = makeDb();
  db.prepare("INSERT INTO options (id, autoOptionType, price, priceType) VALUES (1, 'bathroom_linen', 6, 'per_person')").run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (7, 1, 9)').run();
  const model = createReservationsModel(db);
  const offer = model.getBathLinenOfferForReservation(reservation());
  assert.equal(offer.unitPrice, 9);
  assert.equal(offer.amount, 36); // 4 × 9
});

test('offer: respects a non-per_person priceType (mirrors the engine multiplier)', () => {
  const db = makeDb();
  // per_stay → multiplier 1 → amount = unit price regardless of persons.
  db.prepare("INSERT INTO options (id, autoOptionType, price, priceType) VALUES (1, 'bathroom_linen', 10, 'per_stay')").run();
  const model = createReservationsModel(db);
  const offer = model.getBathLinenOfferForReservation(reservation());
  assert.equal(offer.amount, 10);
});

test('offer: not available when the option is already on the reservation', () => {
  const db = makeDb();
  db.prepare("INSERT INTO options (id, autoOptionType, price, priceType) VALUES (1, 'bathroom_linen', 6, 'per_person')").run();
  const model = createReservationsModel(db);
  const offer = model.getBathLinenOfferForReservation(reservation({ options: [{ autoOptionType: 'bathroom_linen' }] }));
  assert.equal(offer.available, false);
});

test('offer: not available when no bath-linen option exists', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const offer = model.getBathLinenOfferForReservation(reservation());
  assert.equal(offer.available, false);
});

test('offer: not available when the computed amount is 0 (price 0)', () => {
  const db = makeDb();
  db.prepare("INSERT INTO options (id, autoOptionType, price, priceType) VALUES (1, 'bathroom_linen', 0, 'per_person')").run();
  const model = createReservationsModel(db);
  const offer = model.getBathLinenOfferForReservation(reservation());
  assert.equal(offer.available, false);
  assert.equal(offer.amount, 0);
});
