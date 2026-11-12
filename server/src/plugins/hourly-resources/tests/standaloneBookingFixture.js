// Shared fixture of specs/resource-booking-pricing-and-invoicing.md suites: an in-memory database with the plugin's
// table at its current migration, one « Bain fictif » (10:00-22:00, slot 30 min, minimum 60 min, guest 25 / 35 €/h from
// 19:00, external 50 / 70 €/h), and logement 2 offering 60 min. No VAT period table: a sale outside a stay takes the
// plugin's setting, passed in.

const Database = require('better-sqlite3');
const { bookingsV2, bookingsV5, bookingsV3, bookingsV4 } = require('../migrations');
const bookingsModel = require('../bookingsModel');
const { FAR_YEAR } = require('../../../tests/farYearFixture');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, address TEXT, streetNumber TEXT, street TEXT, postalCode TEXT, city TEXT
  );
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, quantity INTEGER DEFAULT 1, price REAL DEFAULT 0,
    priceType TEXT DEFAULT 'per_stay', turnoverMinutes INTEGER DEFAULT 0, minimumUsageMinutes INTEGER DEFAULT 0,
    slotDuration INTEGER DEFAULT 60, isComplex INTEGER DEFAULT 0, openTime TEXT DEFAULT '08:00',
    closeTime TEXT DEFAULT '22:00', openDays TEXT DEFAULT '[0,1,2,3,4,5,6]',
    showsPlanningCard INTEGER DEFAULT 0, hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0,
    hourlyExternalDayRate REAL DEFAULT 0, hourlyExternalEveningRate REAL DEFAULT 0
  );
  CREATE TABLE property_resource_prices (
    propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL DEFAULT 0, freeMinutes INTEGER DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId)
  );
  CREATE TABLE resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER NOT NULL, reservationId INTEGER, clientId INTEGER,
    clientName TEXT, clientPhone TEXT, propertyId INTEGER, date TEXT, startTime TEXT, endTime TEXT,
    notes TEXT DEFAULT '', totalPrice REAL DEFAULT 0, paid INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
`;

const DAY = `${FAR_YEAR}-02-13`;

function seed({ resource = {}, vatRate = 20, now } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  bookingsV2(db);
  bookingsV5(db);
  bookingsV3(db, () => vatRate);
  bookingsV4(db);
  const r = {
    name: 'Bain fictif', quantity: 1, price: 25, priceType: 'per_hour', turnoverMinutes: 0,
    minimumUsageMinutes: 60, slotDuration: 30, isComplex: 1, openTime: '10:00', closeTime: '22:00',
    showsPlanningCard: 1, hourlyEveningStart: '19:00', hourlyEveningRate: 35,
    hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, ...resource,
  };
  const resourceId = Number(db.prepare(`
    INSERT INTO resources (name, quantity, price, priceType, turnoverMinutes, minimumUsageMinutes, slotDuration, isComplex, openTime, closeTime, showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate)
    VALUES (@name, @quantity, @price, @priceType, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @isComplex, @openTime, @closeTime, @showsPlanningCard, @hourlyEveningStart, @hourlyEveningRate, @hourlyExternalDayRate, @hourlyExternalEveningRate)
  `).run(r).lastInsertRowid);
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Cabane fictive')").run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (2, ?, 25, 60)').run(resourceId);
  const model = bookingsModel.create(db, { standaloneVatRate: () => vatRate, ...(now ? { now } : {}) });
  return { db, model, resourceId };
}

// A walk-in guest 18:00-20:00 (one day hour 50 €, one evening hour 70 € from 19:00: 120 €), offered minutes as given.
function book(model, resourceId, extra = {}) {
  const out = model.createBooking({ resourceId, date: DAY, startTime: '18:00', endTime: '20:00', clientName: 'Claire Martin', ...extra });
  if (!out.ok) throw new Error(`book: ${out.error}`);
  return Number(out.id);
}

const card = (amountCents) => [{ method: 'card', amountCents, internal: false }];

module.exports = { seed, book, card, DAY };
