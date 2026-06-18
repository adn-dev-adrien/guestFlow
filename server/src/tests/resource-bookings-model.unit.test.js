const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const resourceBookingsModel = require('../models/resourceBookingsModel');

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

function freshModel(resourceOverrides = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  const r = {
    name: 'Spa', quantity: 1, price: 60, priceType: 'per_hour', turnoverMinutes: 0,
    minimumUsageMinutes: 0, slotDuration: 60, isComplex: 0,
    showsPlanningCard: 0, hourlyEveningStart: null, hourlyEveningRate: 0,
    hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0, ...resourceOverrides,
  };
  const info = db.prepare(`
    INSERT INTO resources (name, quantity, price, priceType, turnoverMinutes, minimumUsageMinutes, slotDuration, isComplex, showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate)
    VALUES (@name, @quantity, @price, @priceType, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @isComplex, @showsPlanningCard, @hourlyEveningStart, @hourlyEveningRate, @hourlyExternalDayRate, @hourlyExternalEveningRate)
  `).run(r);
  return { model: resourceBookingsModel.create(db), db, resourceId: Number(info.lastInsertRowid) };
}

test('computeBookingTotalPrice: per_hour bills duration minus freeMinutes', () => {
  const { model, db, resourceId } = freshModel();
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  assert.equal(model.computeBookingTotalPrice({ resource, startTime: '10:00', endTime: '11:00' }), 60);
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, ?, 60, 60)').run(resourceId);
  // 90 min - 60 free = 30 billed → 30€
  assert.equal(model.computeBookingTotalPrice({ resource, startTime: '10:00', endTime: '11:30', propertyId: 1 }), 30);
});

test('computeBookingTotalPrice: per_stay returns the flat price, free returns 0', () => {
  const flat = freshModel({ priceType: 'per_stay', price: 50 });
  const fr = flat.db.prepare('SELECT * FROM resources WHERE id = ?').get(flat.resourceId);
  assert.equal(flat.model.computeBookingTotalPrice({ resource: fr, startTime: '10:00', endTime: '12:00' }), 50);

  const free = freshModel({ priceType: 'free', price: 99 });
  const frr = free.db.prepare('SELECT * FROM resources WHERE id = ?').get(free.resourceId);
  assert.equal(free.model.computeBookingTotalPrice({ resource: frr, startTime: '10:00', endTime: '12:00' }), 0);
});

// specs/resource-hourly-scheduling.md §3.5 — time-banded grid + external/guest rate selection.
test('computeBookingTotalPrice: hourly-scheduled uses the banded grid; external vs guest rate', () => {
  const { model, db, resourceId } = freshModel({
    priceType: 'per_hour', slotDuration: 30, showsPlanningCard: 1,
    price: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 50,
    hourlyExternalDayRate: 40, hourlyExternalEveningRate: 60,
  });
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  // Guest (tied to a reservation), 19:00–21:00 = 2×15 + 2×25 = 80.
  assert.equal(model.computeBookingTotalPrice({ resource, startTime: '19:00', endTime: '21:00', reservationId: 7 }), 80);
  // External (no reservation), 19:00–21:00 = 2×20 + 2×30 = 100.
  assert.equal(model.computeBookingTotalPrice({ resource, startTime: '19:00', endTime: '21:00' }), 100);
});

test('computeBookingTotalPrice: external rate falls back to the guest grid when unset', () => {
  const { model, db, resourceId } = freshModel({
    priceType: 'per_hour', slotDuration: 30, showsPlanningCard: 1,
    price: 30, hourlyEveningStart: '20:00', hourlyEveningRate: 50,
    // no external rates → fall back to guest
  });
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  assert.equal(model.computeBookingTotalPrice({ resource, startTime: '19:00', endTime: '21:00' }), 80);
});

test('computeBookingTotalPrice: non-scheduled hourly resource keeps the flat price (regression)', () => {
  const { model, db, resourceId } = freshModel({ priceType: 'per_hour', price: 60, showsPlanningCard: 0 });
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  assert.equal(model.computeBookingTotalPrice({ resource, startTime: '10:00', endTime: '11:00' }), 60);
});

test('createBooking: missing fields → 400', () => {
  const { model } = freshModel();
  const r = model.createBooking({ resourceId: null, date: '', startTime: '', endTime: '' });
  assert.equal(r.status, 400);
});

test('createBooking: below minimum usage → 400', () => {
  const { model, resourceId } = freshModel({ priceType: 'per_hour', minimumUsageMinutes: 60 });
  const r = model.createBooking({ resourceId, date: '2099-06-01', startTime: '10:00', endTime: '10:30' });
  assert.equal(r.status, 400);
});

test('createBooking: success then overlapping slot → 409 (capacity 1)', () => {
  const { model, resourceId } = freshModel();
  const ok = model.createBooking({ resourceId, date: '2099-06-01', startTime: '10:00', endTime: '11:00' });
  assert.equal(ok.ok, true);
  const conflict = model.createBooking({ resourceId, date: '2099-06-01', startTime: '10:30', endTime: '11:30' });
  assert.equal(conflict.status, 409);
  // Non-overlapping slot is fine.
  const ok2 = model.createBooking({ resourceId, date: '2099-06-01', startTime: '11:00', endTime: '12:00' });
  assert.equal(ok2.ok, true);
});

test('update: missing booking → 404', () => {
  const { model } = freshModel();
  assert.equal(model.update(999, {}).status, 404);
});
