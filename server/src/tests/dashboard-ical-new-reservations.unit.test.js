const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const { buildController } = require('../controllers/dashboardController');

// specs/dashboard-ical-new-reservations.md — the dashboard card lists reservations imported via
// iCal during the current (UTC) day, fully shaped server-side. These tests pin the model query
// (filters + shaping + ordering) and the controller envelope.

const DDL = `
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    sourceType TEXT NOT NULL DEFAULT 'manual', sourcePlatformKey TEXT, sourceIcalSourceId INTEGER,
    createdAt TEXT
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO ical_sources (id, name) VALUES (1, 'Airbnb')").run();
  return { db, model: reservationsModel.create(db) };
}

// Insert a reservation; createdAt defaults to "today" via datetime('now') unless overridden.
function addRes(db, { kind = 'reservation', sourceType = 'ical', sourceIcalSourceId = 1, sourcePlatformKey = 'airbnb', clientId = 1, propertyId = 1, startDate = '2026-07-10', endDate = '2026-07-13', createdAt = null }) {
  const sql = `INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, sourceType, sourcePlatformKey, sourceIcalSourceId, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${createdAt === null ? "datetime('now')" : '?'})`;
  const params = [kind, propertyId, clientId, startDate, endDate, sourceType, sourcePlatformKey, sourceIcalSourceId];
  if (createdAt !== null) params.push(createdAt);
  return db.prepare(sql).run(...params).lastInsertRowid;
}

test('lists an iCal reservation imported today, fully shaped', () => {
  const { db, model } = freshModel();
  const id = addRes(db, {});
  const rows = model.listNewIcalReservationsToday();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    reservationId: id, clientName: 'Jean Dupont', propertyName: 'Gite',
    platformLabel: 'Airbnb', startDate: '2026-07-10', endDate: '2026-07-13',
    createdAt: rows[0].createdAt, // datetime('now') — value not asserted
  });
});

test('excludes manual reservations created today', () => {
  const { db, model } = freshModel();
  addRes(db, { sourceType: 'manual', sourceIcalSourceId: null, sourcePlatformKey: null });
  assert.equal(model.listNewIcalReservationsToday().length, 0);
});

test('excludes iCal reservations created on another day', () => {
  const { db, model } = freshModel();
  addRes(db, { createdAt: '2020-01-01 10:00:00' });
  assert.equal(model.listNewIcalReservationsToday().length, 0);
});

test('excludes devis (kind="devis")', () => {
  const { db, model } = freshModel();
  addRes(db, { kind: 'devis' });
  assert.equal(model.listNewIcalReservationsToday().length, 0);
});

test('platformLabel falls back to formatted platform key when no iCal source', () => {
  const { db, model } = freshModel();
  addRes(db, { sourceIcalSourceId: null, sourcePlatformKey: 'booking' });
  const rows = model.listNewIcalReservationsToday();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platformLabel, 'Booking');
});

test('orders most-recently-imported first', () => {
  const { db, model } = freshModel();
  const older = addRes(db, {}); // createdAt = now, then pushed back 2h for deterministic ordering (still "today")
  db.prepare("UPDATE reservations SET createdAt = datetime('now', '-2 hours') WHERE id = ?").run(older);
  const newer = addRes(db, {}); // createdAt = now
  const rows = model.listNewIcalReservationsToday();
  assert.deepEqual(rows.map((r) => r.reservationId), [newer, older]);
});

test('controller wraps the list as { alerts }', () => {
  const fakeRows = [{ reservationId: 9, clientName: 'X', propertyName: 'Y', platformLabel: 'Airbnb', startDate: 'a', endDate: 'b', createdAt: 'c' }];
  const controller = buildController({ reservationsModel: { listNewIcalReservationsToday: () => fakeRows } });
  let body = null;
  controller.icalNewReservationsToday({}, { json: (b) => { body = b; } });
  assert.deepEqual(body, { alerts: fakeRows });
});
