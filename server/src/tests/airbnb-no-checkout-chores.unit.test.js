// specs/airbnb-no-checkout-chores.md — Airbnb forbids checkout chores and any request made at arrival:
// the SAS read must never tell the operator to remind an Airbnb guest of the dishes and the trash.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const Database = require('better-sqlite3');

const { isAirbnbChannel } = require('../utils/platformNameFormat');
const { buildContext } = require('../utils/emailContextBuilder');
const { create: createReservationsModel } = require('../models/reservationsModel');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function readSas({ platform, sold }) {
  const reservation = { id: 1, propertyId: 1, platform, startDate: '2026-12-01', endDate: '2026-12-03', options: [], resources: [], nights: [] };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => reservation;
    if (k === 'getSasUpsellOptions') return () => ({
      cleaning: { present: sold, sasOrigin: false, optionId: 3, totalPrice: 80 },
      bathLinen: { present: false, sasOrigin: false, optionId: 9, totalPrice: 0 },
    });
    if (k === 'isCleaningSoldForReservation') return () => sold;
    if (k === 'getCleaningPriceForProperty') return () => 80;
    if (k === 'getBathLinenOfferForReservation') return () => ({ available: false, label: 'Linge de toilette' });
    if (k === 'buildArrivalComplementDetail') return () => ({ amount: 0, paid: 0, detail: [] });
    return () => null;
  } });
  const controller = withMocks({
    '../models/reservationsModel': reservationsModelMock,
    '../models/linenItemsModel': { list: () => [] },
    '../models/settingsModel': { read: () => ({ portalCode: '' }) },
    '../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../models/repairAmountsModel': { list: () => [] },
    '../models/resourceSchedulingModel': { getSchedulingPayload: () => ({ applicable: false, resources: [] }) },
  }, () => {
    delete require.cache[require.resolve('../controllers/sasController')];
    return require('../controllers/sasController');
  });
  delete require.cache[require.resolve('../controllers/sasController')];
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.getSas({ params: { id: 1 }, query: {}, user: { roles: ['admin'] } }, res);
  return res.body;
}

// specs/airbnb-no-checkout-chores.md rule 1
test('Airbnb stay with the ménage included: no guest reminder', () => {
  const body = readSas({ platform: 'Airbnb', sold: true });
  assert.equal(body.cleaning.included, true);
  assert.equal(body.cleaning.guestReminder, false);
});

// specs/airbnb-no-checkout-chores.md rule 4
test('Booking stay with the ménage included: the reminder stays', () => {
  assert.equal(readSas({ platform: 'Booking', sold: true }).cleaning.guestReminder, true);
});

// specs/airbnb-no-checkout-chores.md rule 5
test('Airbnb stay without the ménage: no reminder (the ménage offer page is unchanged)', () => {
  const body = readSas({ platform: 'Airbnb', sold: false });
  assert.equal(body.cleaning.included, false);
  assert.equal(body.cleaning.guestReminder, false);
});

// specs/airbnb-no-checkout-chores.md edge case — no platform counts as direct
test('no recorded platform counts as direct: the reminder stays', () => {
  assert.equal(readSas({ platform: null, sold: true }).cleaning.guestReminder, true);
});

// specs/airbnb-no-checkout-chores.md rule 2
test('isAirbnbChannel ignores case and whitespace, and nothing else is Airbnb', () => {
  assert.equal(isAirbnbChannel('Airbnb'), true);
  assert.equal(isAirbnbChannel(' airbnb '), true);
  assert.equal(isAirbnbChannel('AIRBNB'), true);
  assert.equal(isAirbnbChannel('AirbnbTente'), true, 'an iCal source labelled « Airbnb Tente »');
  assert.equal(isAirbnbChannel('Booking'), false);
  assert.equal(isAirbnbChannel(null), false);
  assert.equal(isAirbnbChannel(''), false);
});

// specs/airbnb-no-checkout-chores.md rule 6
test('e-mails: the Airbnb cleaning line is a booked ménage, and an Airbnb guest is never told the ménage is theirs', () => {
  const ctx = (reservation, customOptions = []) => buildContext({
    reservation: { id: 1, startDate: '2026-12-01', endDate: '2026-12-03', adults: 2, propertyId: 1, ...reservation },
    client: { firstName: 'A' }, property: { id: 1, name: 'La Granja' }, options: [], customOptions, settings: {}, stayFacts: {},
  });
  const paid = ctx({ platform: 'Airbnb' }, [{ description: 'Frais de ménage (Airbnb)', amount: 122 }]);
  assert.equal(paid.flags.hasCleaningOption, true, 'J-1: no « il reste à votre charge »');
  assert.match(paid.vars.cleaningParagraph, /option ménage : profitez de votre dernière matinée/);

  const unpaid = ctx({ platform: 'Airbnb' });
  assert.equal(unpaid.flags.hasCleaningOption, true);
  assert.equal(unpaid.vars.cleaningParagraph, '', 'J-2: no written chore request');

  const booking = ctx({ platform: 'Booking' });
  assert.equal(booking.flags.hasCleaningOption, false, 'other channels unchanged');
  assert.match(booking.vars.cleaningParagraph, /rendre le logement comme vous l'avez trouvé/);
});

function makeDepartureDb(platform) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
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
      touristTaxInComplement INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', propertyId INTEGER, note TEXT);
    CREATE TABLE reservation_resources (
      reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 1,
      unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0, totalPrice REAL DEFAULT 0,
      offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare('INSERT INTO reservations (id, propertyId, adults, platform) VALUES (1, 7, 2, ?)').run(platform);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (9, 'Ménage', 'cleaning', 80, 'per_stay')").run();
  return db;
}


// specs/airbnb-no-checkout-chores.md rule 7
test('departure: the ménage is never billable on an Airbnb stay — read flag and commit guard', () => {
  assert.equal(readSas({ platform: 'Airbnb', sold: false }).cleaning.billableAtDeparture, false);
  assert.equal(readSas({ platform: 'Booking', sold: false }).cleaning.billableAtDeparture, true);
  assert.equal(readSas({ platform: 'Booking', sold: true }).cleaning.billableAtDeparture, false, 'already sold');

  const commit = (platform) => {
    const db = makeDepartureDb(platform);
    createReservationsModel(db).commitDepartureSas(1, {
      endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', qty: 1, unitPrice: 80, amount: 80 }],
    });
    return db.prepare('SELECT endOfStayComplementAmount FROM reservations WHERE id = 1').get().endOfStayComplementAmount;
  };
  assert.equal(commit('Airbnb'), 0, 'the line is dropped whatever the client sends');
  assert.equal(commit('Booking'), 80);
});
