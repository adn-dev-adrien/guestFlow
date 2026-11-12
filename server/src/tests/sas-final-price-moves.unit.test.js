// specs/arrival-departure-sas.md rule 32 (2026-11-12, verification of the manual trial of 4.0.0) — a SAS run that sells or gives
// stay lines moves the stored `finalPrice` by exactly what its lines bill, so the stored total keeps describing the stored lines
// (the fiche's stored summary derives « Prix hébergement » from it and the refund dialog reuses it).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT, cautionWaived INTEGER NOT NULL DEFAULT 0, finalPrice REAL DEFAULT 0,
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
  db.exec('CREATE TABLE IF NOT EXISTS reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sasArrivalOrigin INTEGER DEFAULT 0)');
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare('INSERT INTO reservations (id, propertyId, adults, finalPrice, complementAmount) VALUES (1, 7, 2, 647.8, 30)').run();
  return { db, model: createReservationsModel(db) };
}
const finalPrice = (db) => db.prepare('SELECT finalPrice FROM reservations WHERE id = 1').get().finalPrice;

test('a line sold at check-in raises finalPrice by its amount, a re-run replaces it without drifting', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { complementItems: [{ label: 'Ménage', amount: 40 }] });
  assert.equal(finalPrice(db), 687.8);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Ménage', amount: 40 }] });
  assert.equal(finalPrice(db), 687.8, 'the same selection again moves nothing');
  model.commitArrivalSas(1, { complementItems: [] });
  assert.equal(finalPrice(db), 647.8, 'removing the line takes it back');
});

test('a commit with no line leaves finalPrice alone', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { cautionReceived: true });
  assert.equal(finalPrice(db), 647.8);
});

test('a line sold then offered at check-in bills nothing: finalPrice goes back', () => {
  const { db, model } = makeDb();
  model.commitArrivalSas(1, { complementItems: [{ label: 'Ménage', amount: 40 }] });
  model.commitArrivalSas(1, { complementItems: [{ label: 'Ménage', amount: 40, offered: true }] });
  assert.equal(finalPrice(db), 647.8);
});

// The check-out's gifts (offeredArrivalExtras) go through the same two helpers around `applyOfferedComplementExtras`
// (`billedLinesOf` / `moveFinalPriceBy`), read in `commitDepartureSas`.
