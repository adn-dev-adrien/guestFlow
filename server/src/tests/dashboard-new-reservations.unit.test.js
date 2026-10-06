const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const { buildController } = require('../controllers/dashboardController');

// specs/dashboard-ical-new-reservations.md (amended 2026-10-06) — the dashboard card lists every
// reservation created during the last 24 hours, whatever its origin, fully shaped server-side.
// These tests pin the rolling window, the origin label (rule 9), the ordering and the envelope.

const DDL = `
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT, platform TEXT,
    sourceType TEXT NOT NULL DEFAULT 'manual', sourcePlatformKey TEXT, sourceIcalSourceId INTEGER,
    requestOrigin TEXT, convertedReservationId INTEGER,
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

// Insert a row; `age` is an SQLite modifier applied to now ('-23 hours'…), default: created now.
function addRes(db, {
  kind = 'reservation', sourceType = 'ical', sourceIcalSourceId = 1, sourcePlatformKey = 'airbnb',
  platform = null, requestOrigin = null, convertedReservationId = null, age = '+0 seconds',
}) {
  return db.prepare(`
    INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType,
                              sourcePlatformKey, sourceIcalSourceId, requestOrigin, convertedReservationId, createdAt)
    VALUES (?, 1, 1, '2026-07-10', '2026-07-13', ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `).run(kind, platform, sourceType, sourcePlatformKey, sourceIcalSourceId, requestOrigin, convertedReservationId, age).lastInsertRowid;
}

const manual = (over = {}) => ({ sourceType: 'manual', sourceIcalSourceId: null, sourcePlatformKey: null, ...over });
const ids = (rows) => rows.map((r) => r.reservationId);

test('rule 3 — lists an iCal reservation created now, fully shaped', () => {
  const { db, model } = freshModel();
  const id = addRes(db, {});
  const rows = model.listNewReservations();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    reservationId: id, clientName: 'Jean Dupont', propertyName: 'Gite',
    platformLabel: 'Airbnb', startDate: '2026-07-10', endDate: '2026-07-13',
    createdAt: rows[0].createdAt,
  });
});

// Under the former UTC-day rule, 23 h 59 ago almost always fell on the previous day and was dropped.
test('rule 2 — keeps a reservation created 23 h 59 ago, drops one created 24 h 01 ago', () => {
  const { db, model } = freshModel();
  const inside = addRes(db, { age: '-1439 minutes' });
  addRes(db, { age: '-1441 minutes' });
  assert.deepEqual(ids(model.listNewReservations()), [inside]);
});

test('rule 1 — lists every origin: iCal, website and GuestFlow entries', () => {
  const { db, model } = freshModel();
  const ical = addRes(db, { age: '-3 hours' });
  const site = addRes(db, manual({ platform: 'Lodgify', age: '-2 hours' }));
  addRes(db, manual({ kind: 'devis', requestOrigin: 'public', convertedReservationId: site, age: '-5 hours' }));
  const entered = addRes(db, manual({ platform: 'direct', age: '-1 hours' }));
  assert.deepEqual(ids(model.listNewReservations()), [entered, site, ical]);
});

test('rule 1 — excludes devis, even a website request', () => {
  const { db, model } = freshModel();
  addRes(db, manual({ kind: 'devis' }));
  addRes(db, manual({ kind: 'devis', requestOrigin: 'public' }));
  assert.equal(model.listNewReservations().length, 0);
});

test('rule 9 — iCal label: source name first, then the formatted platform key', () => {
  const { db, model } = freshModel();
  addRes(db, { sourceIcalSourceId: null, sourcePlatformKey: 'booking' });
  assert.equal(model.listNewReservations()[0].platformLabel, 'Booking');
});

test('rule 9 — label is « Site » for a reservation converted from a website devis', () => {
  const { db, model } = freshModel();
  const id = addRes(db, manual({ platform: 'Lodgify' }));
  addRes(db, manual({ kind: 'devis', requestOrigin: 'public', convertedReservationId: id, age: '-3 days' }));
  assert.equal(model.listNewReservations()[0].platformLabel, 'Site');
});

test('rule 9 — a devis converted from the back-office does not make the label « Site »', () => {
  const { db, model } = freshModel();
  const id = addRes(db, manual({ platform: 'Lodgify' }));
  addRes(db, manual({ kind: 'devis', requestOrigin: null, convertedReservationId: id, age: '-3 days' }));
  assert.equal(model.listNewReservations()[0].platformLabel, 'Lodgify');
});

test('rule 9 — label of a GuestFlow entry is its channel, « direct » shown as « Direct »', () => {
  const { db, model } = freshModel();
  addRes(db, manual({ platform: 'direct', age: '-2 hours' }));
  addRes(db, manual({ platform: 'GitesDeFrance', age: '-1 hours' }));
  addRes(db, manual({ platform: null }));
  assert.deepEqual(model.listNewReservations().map((r) => r.platformLabel), ['', 'Gîtes de France', 'Direct']);
});

test('rule 6 — orders most recent first', () => {
  const { db, model } = freshModel();
  const older = addRes(db, { age: '-2 hours' });
  const newer = addRes(db, {});
  assert.deepEqual(ids(model.listNewReservations()), [newer, older]);
});

test('controller wraps the list as { alerts }', () => {
  const fakeRows = [{ reservationId: 9, clientName: 'X', propertyName: 'Y', platformLabel: 'Airbnb', startDate: 'a', endDate: 'b', createdAt: 'c' }];
  const controller = buildController({ reservationsModel: { listNewReservations: () => fakeRows } });
  let body = null;
  controller.newReservations({}, { json: (b) => { body = b; } });
  assert.deepEqual(body, { alerts: fakeRows });
});
