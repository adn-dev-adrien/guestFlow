const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const resourcesModel = require('../models/resourcesModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    note TEXT DEFAULT '',
    isComplex INTEGER NOT NULL DEFAULT 0,
    slotDuration INTEGER NOT NULL DEFAULT 60,
    minimumUsageMinutes INTEGER NOT NULL DEFAULT 0,
    openTime TEXT NOT NULL DEFAULT '08:00',
    closeTime TEXT NOT NULL DEFAULT '22:00',
    openDays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    turnoverMinutes INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE resource_properties (
    resourceId INTEGER NOT NULL, propertyId INTEGER NOT NULL,
    PRIMARY KEY (resourceId, propertyId),
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  );
  CREATE TABLE property_resource_prices (
    propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL NOT NULL DEFAULT 0, freeMinutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId),
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, startDate TEXT, endDate TEXT,
    platform TEXT, finalPrice REAL, babyBeds INTEGER DEFAULT 0
  );
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );
  CREATE TABLE resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER NOT NULL, propertyId INTEGER,
    clientName TEXT, date TEXT, startTime TEXT, endTime TEXT,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Villa A');
  db.prepare('INSERT INTO properties (id, name) VALUES (2, ?)').run('Villa B');
  return { model: resourcesModel.create(db), db };
}

test('insert stores applicability + per-property pricing; findById rebuilds propertyIds + pricing', () => {
  const { model } = freshModel();
  const id = model.insert({
    name: 'bain nordique', quantity: 1, price: 30, priceType: 'per_hour',
    propertyIds: [1], propertyPricing: { 1: { price: 25, freeMinutes: 60 } },
  });
  const r = model.findById(id);
  assert.equal(r.name, 'Bain nordique');
  assert.deepEqual(r.propertyIds, [1]);
  assert.equal(r.propertyPricing['1'].price, 25);
  assert.equal(r.propertyPricing['1'].freeMinutes, 60);
});

test('list applies global resources everywhere and scoped resources only to their property', () => {
  const { model } = freshModel();
  model.insert({ name: 'Global', quantity: 5, price: 10 });
  model.insert({ name: 'Scoped to 1', quantity: 5, price: 10, propertyIds: [1] });

  const forP1 = model.list(1).map((r) => r.name).sort();
  const forP2 = model.list(2).map((r) => r.name).sort();
  assert.deepEqual(forP1, ['Global', 'Scoped to 1']);
  assert.deepEqual(forP2, ['Global']);
});

test('effective price uses the per-property override, base otherwise', () => {
  const { model } = freshModel();
  model.insert({ name: 'R', quantity: 1, price: 30, propertyIds: [1, 2], propertyPricing: { 1: { price: 25, freeMinutes: 0 } } });
  const p1 = model.list(1)[0];
  const p2 = model.list(2)[0];
  assert.equal(p1.price, 25); // override
  assert.equal(p1.basePrice, 30);
  assert.equal(p2.price, 30); // base
});

test('availability reflects overlapping reservation_resources', () => {
  const { model, db } = freshModel();
  const id = model.insert({ name: 'R', quantity: 3, price: 10 });
  const resv = db.prepare('INSERT INTO reservations (propertyId, startDate, endDate) VALUES (1, ?, ?)').run('2099-06-01', '2099-06-05');
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity) VALUES (?, ?, ?)').run(resv.lastInsertRowid, id, 2);

  const avail = model.availability(1, '2099-06-02', '2099-06-03').find((r) => r.id === id);
  assert.equal(avail.reserved, 2);
  assert.equal(avail.available, 1);
  assert.equal(avail.unavailable, false);
});

test('update replaces applicability + pricing', () => {
  const { model } = freshModel();
  const id = model.insert({ name: 'R', quantity: 1, price: 10, propertyIds: [1], propertyPricing: { 1: { price: 9, freeMinutes: 0 } } });
  model.update(id, { name: 'R', quantity: 1, price: 10, propertyIds: [2], propertyPricing: { 2: { price: 8, freeMinutes: 0 } } });
  const r = model.findById(id);
  assert.deepEqual(r.propertyIds, [2]);
  assert.equal(r.propertyPricing['2'].price, 8);
  assert.equal(r.propertyPricing['1'], undefined);
});

test('getDeleteImpact counts reservations and bookings using the resource', () => {
  const { model, db } = freshModel();
  const id = model.insert({ name: 'R', quantity: 5, price: 10 });
  const resv = db.prepare('INSERT INTO reservations (propertyId, startDate, endDate) VALUES (1, ?, ?)').run('2099-06-01', '2099-06-05');
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity) VALUES (?, ?, 1)').run(resv.lastInsertRowid, id);
  db.prepare('INSERT INTO resource_bookings (resourceId, propertyId, date, startTime, endTime) VALUES (?, 1, ?, ?, ?)').run(id, '2099-07-01', '10:00', '11:00');

  const impact = model.getDeleteImpact(id);
  assert.equal(impact.reservationsCount, 1);
  assert.equal(impact.bookingsCount, 1);
  assert.equal(model.getDeleteImpact(9999), null);
});
