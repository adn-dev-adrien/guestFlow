// specs/arrival-departure-sas.md rule 31 (2026-11-12, manual trial of 4.0.0) — « Non » on the check-in's caution page:
// no caution is taken for the stay. Stored as a marker on the reservation; the effective caution reads 0 while it is
// set, so the fiche, the ledger (« Caution · Sans objet », reservation-payment-ledger rule 74) and the departure SAS
// (no caution to return) read the same thing. A caution received afterwards clears it.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel, __test: { resolveEffectiveCaution } } = require('../models/reservationsModel');
const { buildLedger } = require('../utils/reservationLedger');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT, cautionWaived INTEGER NOT NULL DEFAULT 0,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      complementAmountOverride REAL, endOfStayComplementAmountOverride REAL,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT,
      breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  // specs/caution-live-from-property.md §3 — commitArrivalSas freezes the property's caution on receipt.
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare('INSERT INTO reservations (id, propertyId, adults, cautionAmount) VALUES (1, 7, 2, 0)').run();
  return { db, model: createReservationsModel(db) };
}

const effective = (db) => resolveEffectiveCaution({ ...db.prepare('SELECT * FROM reservations WHERE id = 1').get(), propertyDefaultCautionAmount: 500 });
const row = (db) => db.prepare('SELECT cautionReceived, cautionWaived, cautionAmount FROM reservations WHERE id = 1').get();

test('the caution is live from the property until « Non » is answered, then reads 0', () => {
  const { db, model } = makeDb();
  assert.equal(effective(db), 500);
  model.commitArrivalSas(1, { cautionReceived: false, cautionWaived: true });
  assert.deepEqual(row(db), { cautionReceived: 0, cautionWaived: 1, cautionAmount: 0 });
  assert.equal(effective(db), 0);
});

test('the answer can be changed on a re-edit: the caution is asked again', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { cautionReceived: false, cautionWaived: true });
  model.commitArrivalSas(1, { cautionReceived: false, cautionWaived: false });
  assert.equal(row(db).cautionWaived, 0);
  assert.equal(effective(db), 500);
});

test('a caution not asked about this run (tri-state undefined) leaves the marker alone', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { cautionReceived: false, cautionWaived: true });
  model.commitArrivalSas(1, {});
  assert.equal(row(db).cautionWaived, 1);
});

test('receiving the caution afterwards clears « Non » and freezes the property amount', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { cautionReceived: false, cautionWaived: true });
  model.commitArrivalSas(1, { cautionReceived: true, cautionWaived: false });
  assert.deepEqual(row(db), { cautionReceived: 1, cautionWaived: 0, cautionAmount: 500 });
});

test('a caution already held is never waived', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { cautionReceived: true });
  model.commitArrivalSas(1, { cautionWaived: true });
  assert.equal(row(db).cautionWaived, 0);
  assert.equal(effective(db), 500);
});

test('the ledger reads « Caution · Sans objet » for a stay whose caution is 0, with no action', () => {
  // date-literal-ok: a stay of a ledger fixture, the ledger is not asked about today
  const ledger = buildLedger({ row: { id: 1, kind: 'reservation', platform: 'direct', startDate: '2026-12-01', endDate: '2026-12-03', cautionReceived: 0, cautionReturned: 0 }, cautionAmount: 0 });
  const caution = ledger.rows.find((r) => r.key === 'caution');
  assert.equal(caution.stateLabel, 'Sans objet');
  assert.equal(caution.action, null);
});
