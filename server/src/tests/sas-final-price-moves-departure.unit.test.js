// specs/arrival-departure-sas.md rule 32 — the check-out's gifts on a recalled arrival complement (`offeredArrivalExtras`) move the
// stored `finalPrice` like the check-in's: by exactly what the stay's lines stop (or start again) billing.

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
      extraGuestSurchargeOffered INTEGER NOT NULL DEFAULT 0, platformPaidGuests INTEGER,
      extraGuestComplementSurcharge REAL NOT NULL DEFAULT 0, extraGuestComplementCount INTEGER NOT NULL DEFAULT 0,
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
  db.prepare('INSERT INTO reservations (id, propertyId, adults, finalPrice, complementAmount) VALUES (1, 7, 2, 647.8, 80)').run();
  return { db, model: createReservationsModel(db) };
}
const finalPrice = (db) => db.prepare('SELECT finalPrice FROM reservations WHERE id = 1').get().finalPrice;
// An unpaid arrival complement of 80 € (a 30 € line, a 50 € line), recalled at check-out.
function withLines() {
  const made = makeDb();
  made.db.prepare("INSERT INTO options (id, title, price) VALUES (40, 'Bois', 30), (41, 'Panier', 50)").run();
  made.db.prepare('INSERT INTO reservation_options (reservationId, optionId, unitPrice, billedUnits, totalPrice, inComplement) VALUES (1, 40, 30, 1, 30, 1), (1, 41, 50, 1, 50, 1)').run();
  return made;
}
const depart = (model, refs) => model.commitDepartureSas(1, { endOfStayComplementDetail: [], offeredArrivalExtras: refs });

test('a line offered at check-out lowers finalPrice by its amount; the same gifts again move nothing', () => {
  const { db, model } = withLines();
  depart(model, [{ kind: 'option', id: 40 }]);
  assert.equal(finalPrice(db), 617.8);
  depart(model, [{ kind: 'option', id: 40 }]);
  assert.equal(finalPrice(db), 617.8, 'a re-run with the same gifts does not drift');
});

test('a gift taken back at a re-run bills the line again: finalPrice goes back', () => {
  const { db, model } = withLines();
  depart(model, [{ kind: 'option', id: 40 }]);
  assert.equal(finalPrice(db), 617.8);
  depart(model, []);
  assert.equal(finalPrice(db), 647.8);
});

test('a collected arrival complement is not recalled: its refs are ignored and finalPrice does not move', () => {
  const { db, model } = withLines();
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  depart(model, [{ kind: 'option', id: 40 }]);
  assert.equal(finalPrice(db), 647.8);
});

test('the added guests offered at check-out lower finalPrice by their surcharge', () => {
  const { db, model } = makeDb();
  db.prepare("UPDATE reservations SET platform = 'Booking', adults = 3, platformPaidGuests = 2, extraGuestComplementSurcharge = 50, extraGuestComplementCount = 1, complementAmount = 50, finalPrice = 697.8 WHERE id = 1").run();
  depart(model, [{ kind: 'extraGuests', id: 0 }]);
  assert.equal(db.prepare('SELECT extraGuestSurchargeOffered AS o FROM reservations WHERE id = 1').get().o, 1);
  assert.equal(finalPrice(db), 647.8);
});
