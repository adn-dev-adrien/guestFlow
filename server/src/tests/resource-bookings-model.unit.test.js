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
    closeTime TEXT DEFAULT '22:00', openDays TEXT DEFAULT '[0,1,2,3,4,5,6]'
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
    minimumUsageMinutes: 0, slotDuration: 60, isComplex: 0, ...resourceOverrides,
  };
  const info = db.prepare(`
    INSERT INTO resources (name, quantity, price, priceType, turnoverMinutes, minimumUsageMinutes, slotDuration, isComplex)
    VALUES (@name, @quantity, @price, @priceType, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @isComplex)
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
