// specs/reservations-backend-mvc.md rule 13 (past reading of 2026-11-02) on the resource bookings — the preview,
// the create and the update take a real day from today − 5 years to today + 5 years (400, nothing written);
// an edited booking keeps its stored day whatever it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const resourceBookingsModel = require('../bookingsModel');
const { horizonStart, horizonEnd, PAST_HORIZON_MESSAGE, HORIZON_MESSAGE } = require('../../../utils/stayDates');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
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

const S = horizonStart();
const H = horizonEnd();
const before = addDaysToIsoDate(S, -1);
const after = addDaysToIsoDate(H, 1);

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  const resourceId = Number(db.prepare("INSERT INTO resources (name, price, priceType) VALUES ('Spa', 60, 'per_hour')").run().lastInsertRowid);
  return { db, model: resourceBookingsModel.create(db), resourceId };
}

const slot = { startTime: '10:00', endTime: '11:00' };
const bookings = (db) => db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n;

test('the preview and the create take today − 5 years and today + 5 years, refuse one day outside', () => {
  const { db, model, resourceId } = fresh();
  for (const [date, error] of [[before, PAST_HORIZON_MESSAGE], [after, HORIZON_MESSAGE], [`${S.slice(0, 4)}-02-30`, 'Date invalide.']]) {
    assert.deepEqual(model.priceBooking({ resourceId, date, ...slot }), { error, status: 400 });
    assert.deepEqual(model.createBooking({ resourceId, date, ...slot }), { error, status: 400 });
  }
  assert.equal(bookings(db), 0);
  for (const date of [S, H]) {
    assert.equal(model.priceBooking({ resourceId, date, ...slot }).error, undefined);
    assert.equal(model.createBooking({ resourceId, date, ...slot }).ok, true);
  }
});

test('an edited booking keeps its stored day; moving it outside the window is refused', () => {
  const { db, model, resourceId } = fresh();
  const id = Number(db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, ?, '10:00', '11:00')").run(resourceId, before).lastInsertRowid);
  assert.equal(model.update(id, { notes: 'Relu' }).ok, true);
  assert.equal(model.priceBooking({ resourceId, bookingId: id, date: before, ...slot }).error, undefined);
  assert.deepEqual(model.update(id, { date: addDaysToIsoDate(before, -1) }), { error: PAST_HORIZON_MESSAGE, status: 400 });
  assert.equal(db.prepare('SELECT date FROM resource_bookings WHERE id = ?').get(id).date, before);
  assert.equal(model.update(id, { date: S }).ok, true);
});
