// specs/resource-booking-pricing-and-invoicing.md rule 49 (reading of rule 34, audits R36-DB-M1 = R36-RES-L1, 2026-11-10) — every
// client cleanup shares the orphan popup's condition: a client a resource booking names (plugin `hourly-resources`, paid
// or not, on any logement or none) is kept by the logement delete and by the two iCal cleanups, and his booking keeps him.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const propertiesModel = require('../models/propertiesModel');
const { removeOrphanIcalPlaceholders, removeOrphanIcalImportClients } = require('../utils/icalPlaceholderClientsMigration');
const { noResourceBookingSql } = require('../utils/deletionGuard');
const hourly = optionalPlugin(() => require('../plugins/hourly-resources/migrations'));
const needs = { skip: skipWithout(['hourly-resources']) };
const { FAR_YEAR: Y } = require('./farYearFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.pragma('foreign_keys = ON');
  hourly.createTables(db);
  hourly.bookingsV2(db);
  hourly.bookingsV3(db, () => 20);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite fictif'), (2, 'Logement sonde')").run();
  const resourceId = Number(db.prepare("INSERT INTO resources (name, priceType, price) VALUES ('Sauna fictif', 'per_stay', 40)").run().lastInsertRowid);
  const book = (clientId, extra = {}) => Number(db.prepare(`INSERT INTO resource_bookings (resourceId, clientId, propertyId, date, startTime, endTime, totalPrice, paid, paidAt, paymentRecordedAt)
    VALUES (@resourceId, @clientId, @propertyId, @date, '18:00', '19:00', 40, @paid, @paidAt, @paidAt)`).run({
    resourceId, clientId, propertyId: 1, date: `${Y}-02-13`, paid: 1, paidAt: `${Y}-02-13`, ...extra,
  }).lastInsertRowid);
  const stay = (clientId, propertyId) => db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults)
    VALUES (?, ?, '${Y}-03-01', '${Y}-03-04', 2)`).run(propertyId, clientId);
  const client = (firstName, lastName, notes = null) => Number(db.prepare('INSERT INTO clients (firstName, lastName, notes) VALUES (?, ?, ?)')
    .run(firstName, lastName, notes).lastInsertRowid);
  return { db, book, stay, client };
}

const exists = (db, id) => Boolean(db.prepare('SELECT 1 FROM clients WHERE id = ?').get(id));

test('R36-DB-M1 — a logement delete keeps the client of its stays who bought a session elsewhere; his booking keeps him', needs, () => {
  const { db, book, stay, client } = seed();
  const buyer = client('Ana', 'Lune');
  const plain = client('Noé', 'Vent');
  stay(buyer, 2);
  stay(plain, 2);
  const booking = book(buyer);
  const model = propertiesModel.buildModel(db);
  assert.equal(model.deletionBlocker(2), null, 'nothing on the logement itself is money');
  assert.deepEqual(model.removeGuarded(2), { ok: true });
  assert.equal(exists(db, buyer), true, 'the buyer of a paid session stays');
  assert.equal(exists(db, plain), false, 'a client with nothing left still goes');
  assert.equal(db.prepare('SELECT clientId FROM resource_bookings WHERE id = ?').get(booking).clientId, buyer);
});

test('R36-DB-M1 — an unpaid session keeps its client too, as the orphan popup does', needs, () => {
  const { db, book, stay, client } = seed();
  const buyer = client('Ana', 'Lune');
  stay(buyer, 2);
  book(buyer, { paid: 0, paidAt: null, propertyId: null });
  assert.deepEqual(propertiesModel.buildModel(db).removeGuarded(2), { ok: true });
  assert.equal(exists(db, buyer), true);
});

test('R36-RES-L1 — the iCal sync cleanups keep a client a booking names', needs, () => {
  const { db, book, client } = seed();
  const imported = client('Marie', 'Lac', 'iCal {"uid":"x"}');
  const importedAlone = client('Paul', 'Mer', 'iCal {"uid":"y"}');
  const placeholder = client('Ical', 'Airbnb');
  const placeholderAlone = client('Ical', 'Booking');
  book(imported);
  book(placeholder, { paid: 0, paidAt: null, date: `${Y}-02-14` });
  assert.equal(removeOrphanIcalImportClients(db), 1);
  assert.equal(removeOrphanIcalPlaceholders(db), 1);
  assert.deepEqual([imported, importedAlone, placeholder, placeholderAlone].map((id) => exists(db, id)), [true, false, true, false]);
});

test('R36-DB-M1 — without the plugin table the condition reads nothing', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  assert.equal(noResourceBookingSql(db, 'clients'), '');
  db.prepare("INSERT INTO clients (firstName, lastName, notes) VALUES ('Paul', 'Mer', 'iCal {}')").run();
  assert.equal(removeOrphanIcalImportClients(db), 1);
});
