// specs/caution-live-from-property.md — the caution amount a reservation displays is LIVE from the
// property's current `defaultCautionAmount` until the caution is received, then FROZEN to the amount
// actually collected. These tests cover the pure resolver + the `list()` read path. The freeze-on-receipt
// write is covered by sas-commit.unit.test.js (commitArrivalSas), and markPayment mirrors that same SQL.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const { resolveEffectiveCaution } = reservationsModel.__test;

test('resolveEffectiveCaution: live from property while not received, frozen once received', () => {
  // Not received → the property's current default, ignoring the stored snapshot.
  assert.equal(resolveEffectiveCaution({ cautionReceived: 0, cautionAmount: 300, propertyDefaultCautionAmount: 500 }), 500);
  // Received → the frozen collected amount, even when the property default differs.
  assert.equal(resolveEffectiveCaution({ cautionReceived: 1, cautionAmount: 300, propertyDefaultCautionAmount: 500 }), 300);
  // Missing values → 0, never NaN/undefined.
  assert.equal(resolveEffectiveCaution({}), 0);
  assert.equal(resolveEffectiveCaution(null), 0);
});

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCautionAmount REAL DEFAULT 0);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    platform TEXT DEFAULT 'direct', finalPrice REAL DEFAULT 0, customPrice REAL,
    cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
    clientGrossAmount REAL
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, totalPrice REAL);
  CREATE TABLE reservation_custom_options (reservationId INTEGER, amount REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, totalPrice REAL);
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name, defaultCautionAmount) VALUES (1, 'Gite', 700)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  // Two reservations on the same property, both carrying a STALE stored snapshot of 500.
  // #1 not received → should display the live property default (700). #2 received → frozen 500.
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, cautionAmount, cautionReceived) VALUES (1, 1, 1, '2026-07-10', '2026-07-13', 500, 0)").run();
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, cautionAmount, cautionReceived) VALUES (2, 1, 1, '2026-08-10', '2026-08-13', 500, 1)").run();
  return { db, model: reservationsModel.create(db) };
}

test('list(): caution is live from the property when not received, frozen when received', () => {
  const { model } = fresh();
  const byId = new Map(model.list().map((r) => [r.id, r]));
  assert.equal(byId.get(1).cautionAmount, 700, 'not received → live property default, not the stale 500');
  assert.equal(byId.get(2).cautionAmount, 500, 'received → frozen collected amount');
});

test('list(): raising the property default updates every not-yet-received reservation at once', () => {
  const { db, model } = fresh();
  // Operator changes the property caution in Settings after the reservations already exist.
  db.prepare('UPDATE properties SET defaultCautionAmount = 900 WHERE id = 1').run();
  const byId = new Map(model.list().map((r) => [r.id, r]));
  assert.equal(byId.get(1).cautionAmount, 900, 'not received → now reflects the new property default');
  assert.equal(byId.get(2).cautionAmount, 500, 'received → still frozen at the collected amount');
});
