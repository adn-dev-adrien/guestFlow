const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// Anti-overbooking regression guard for the devis↔reservation fusion: a devis (kind='devis') must NEVER
// be seen by the reservation-side reads — list, occupancy, resource-reserved, baby-bed availability —
// otherwise a tentative quote would block real bookings.
const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00', babyBeds INTEGER DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, totalPrice REAL);
  CREATE TABLE reservation_custom_options (reservationId INTEGER, amount REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, totalPrice REAL);
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0);
  CREATE TABLE resource_properties (resourceId INTEGER, propertyId INTEGER);
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO resources (id, name, quantity) VALUES (5, 'Vélo', 10), (9, 'Lit bébé', 2)").run();

  // A real reservation and a devis on the SAME overlapping dates, both using a bike + a baby bed.
  const resa = db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, babyBeds) VALUES ('reservation', 1, 1, '2026-07-10', '2026-07-13', 1)").run().lastInsertRowid;
  const devis = db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, babyBeds) VALUES ('devis', 1, 1, '2026-07-10', '2026-07-13', 1)").run().lastInsertRowid;
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, totalPrice) VALUES (?, 5, 1, 20)').run(resa);
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, totalPrice) VALUES (?, 5, 2, 40)').run(devis);
  return { db, model: reservationsModel.create(db), resa, devis };
}

test('list() returns reservations only — never a devis', () => {
  const { model, resa } = fresh();
  const rows = model.list({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, resa);
  assert.equal(rows[0].kind, 'reservation');
});

test('getOccupiedReservations ignores devis (a devis never blocks a date)', () => {
  const { model, resa } = fresh();
  const occupied = model.getOccupiedReservations(1, '2026-07-09', '2026-07-14');
  assert.equal(occupied.length, 1);
  assert.equal(occupied[0].id, resa);
});

test('getResourceReservedQuantity counts the reservation only, not the devis', () => {
  const { model } = fresh();
  // resa books 1 bike, devis "books" 2 — only the reservation's 1 must count.
  assert.equal(model.getResourceReservedQuantity(5, '2026-07-09', '2026-07-14'), 1);
});

test('getBabyBedAvailability does not count the devis baby bed', () => {
  const { model } = fresh();
  // 2 baby beds total; the reservation uses 1, the devis must not consume one → 1 left.
  assert.equal(model.getBabyBedAvailability(1, '2026-07-10', '2026-07-13'), 1);
});
