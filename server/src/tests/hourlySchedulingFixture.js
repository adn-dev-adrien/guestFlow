// Shared fixture: a stay with a Bain nordique sold by the hour
// (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4). Used by the scheduling and the
// evening-supplement suites.

const Database = require('better-sqlite3');

const resourceSchedulingModel = require('../models/resourceSchedulingModel');
const { create: createReservationsModel } = require('../models/reservationsModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCautionAmount REAL DEFAULT 0);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, nameEn TEXT DEFAULT '', quantity INTEGER DEFAULT 1,
    price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_hour', note TEXT DEFAULT '',
    turnoverMinutes INTEGER DEFAULT 0, minimumUsageMinutes INTEGER DEFAULT 60, slotDuration INTEGER DEFAULT 60,
    isComplex INTEGER DEFAULT 1, openTime TEXT DEFAULT '11:00', closeTime TEXT DEFAULT '22:00',
    openDays TEXT DEFAULT '[0,1,2,3,4,5,6]', closedDays TEXT DEFAULT '[]',
    showsPlanningCard INTEGER DEFAULT 1, hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0,
    hourlyExternalDayRate REAL DEFAULT 0, hourlyExternalEveningRate REAL DEFAULT 0,
    heatUpMinutes INTEGER DEFAULT 0, heatRetentionMinutes INTEGER DEFAULT 0,
    createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE resource_properties (resourceId INTEGER, propertyId INTEGER);
  CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL DEFAULT 0, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
  CREATE TABLE resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER NOT NULL, reservationId INTEGER, clientId INTEGER,
    clientName TEXT, clientPhone TEXT, propertyId INTEGER, date TEXT, startTime TEXT, endTime TEXT,
    notes TEXT DEFAULT '', totalPrice REAL DEFAULT 0, paid INTEGER DEFAULT 0
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    checkInTime TEXT DEFAULT '16:00', checkOutTime TEXT DEFAULT '10:00',
    adults INTEGER DEFAULT 2, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
    complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
    complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
    complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
    endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
    arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
    checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
    extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER, breakfastTime TEXT,
    breakfastCoffee INTEGER DEFAULT 0, breakfastTea INTEGER DEFAULT 0, breakfastChocolate INTEGER DEFAULT 0,
    breakfastMilk INTEGER DEFAULT 0, breakfastPastries INTEGER DEFAULT 0, breakfastCereals INTEGER DEFAULT 0,
    breakfastBread REAL DEFAULT 0, breakfastNotifiedDate TEXT, breakfastNote TEXT, departureHandoverNote TEXT,
    updatedAt TEXT
  );
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 0,
    unitPrice REAL DEFAULT 0, billedUnits REAL DEFAULT 0, priceType TEXT, totalPrice REAL DEFAULT 0,
    offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, sessions TEXT
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
    inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
    sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 0,
    unitPrice REAL DEFAULT 0, billedUnits REAL DEFAULT 0, priceType TEXT, totalPrice REAL DEFAULT 0,
    offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, sasArrivalOrigin INTEGER DEFAULT 0,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL DEFAULT 0);
  -- Read by getSasUpsellOptions (ménage / linge de toilette): none configured here, so both upsells
  -- resolve to « nothing to offer » and stay out of the way of the resource-scheduling assertions.
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay',
    autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, price REAL);
`;

// Stay 11→14 Sept 2026, check-in 16:00. Bain nordique: 30 €/h day, 50 €/h from 20:00,
// 15 min turnover, no warm-up unless a test asks for one.
function seed({ hoursSold = 3, sessions = null, resource = {} } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura lodge')").run();
  const r = {
    name: 'Bain nordique', price: 30, turnoverMinutes: 15, minimumUsageMinutes: 60, slotDuration: 60,
    openTime: '11:00', closeTime: '22:00', hourlyEveningStart: '20:00', hourlyEveningRate: 50,
    heatUpMinutes: 0, heatRetentionMinutes: 0, quantity: 1, ...resource,
  };
  const info = db.prepare(`
    INSERT INTO resources (name, price, turnoverMinutes, minimumUsageMinutes, slotDuration, openTime, closeTime,
      hourlyEveningStart, hourlyEveningRate, heatUpMinutes, heatRetentionMinutes, quantity)
    VALUES (@name, @price, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @openTime, @closeTime,
      @hourlyEveningStart, @hourlyEveningRate, @heatUpMinutes, @heatRetentionMinutes, @quantity)
  `).run(r);
  const resourceId = Number(info.lastInsertRowid);

  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime)
              VALUES (500, 1, '2026-09-11', '2026-09-14', '16:00', '10:00')`).run();
  if (hoursSold > 0) {
    db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions) VALUES (500, ?, ?, 30, ?, ?, ?, ?)')
      .run(resourceId, hoursSold, hoursSold, 'per_hour', hoursSold * 30, sessions ? JSON.stringify(sessions) : null);
  }

  const reservation = { id: 500, propertyId: 1, startDate: '2026-09-11', endDate: '2026-09-14', checkInTime: '16:00', checkOutTime: '10:00' };
  return {
    db, resourceId, reservation,
    scheduling: resourceSchedulingModel.create(db),
    reservations: createReservationsModel(db),
  };
}

module.exports = { DDL, seed };
