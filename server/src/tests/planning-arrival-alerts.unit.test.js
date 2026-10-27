const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/planningAlertsModel');
const { computePlanningAlerts } = require('../utils/planningArrivalAlerts');

// specs/planning-arrival-alerts.md §3 rules 1–3 and 7–10 — the planning cleaning alerts, computed on
// the server from real check-in / check-out times and each logement's cleaning hours, keyed by card
// kind. Reproduces the 2026-10-27 spec-review findings F1–F4.

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, cleaningHours REAL DEFAULT 3);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
    icalOriginalSummary TEXT
  );
`;

const GITE = 1; const TENTE = 2; const STUDIO = 3; const CABANE = 4;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  const p = db.prepare('INSERT INTO properties (id, name, cleaningHours) VALUES (?, ?, ?)');
  p.run(GITE, 'Gîte', 4); p.run(TENTE, 'Tente', 2); p.run(STUDIO, 'Studio', 1); p.run(CABANE, 'Cabane', 1);
  return db;
}

let clientSeq = 0;
function stay(db, { id, propertyId, start, end, inTime = '15:00', outTime = '10:00', name = `Client ${id}`, kind = 'reservation' }) {
  clientSeq += 1;
  const [firstName, lastName] = name.split(' ');
  db.prepare('INSERT INTO clients (id, firstName, lastName) VALUES (?, ?, ?)').run(clientSeq, firstName, lastName || '');
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, kind, propertyId, clientSeq, start, end, inTime, outTime);
}

const WINDOW = { from: '2026-10-27', to: '2026-11-09' };

test('F1 — a guest already in the house (arrived before the window) still raises the turnover alert', () => {
  const db = freshDb();
  stay(db, { id: 1, propertyId: GITE, start: '2026-10-25', end: '2026-10-29', outTime: '10:00', name: 'Marie Durand' });
  stay(db, { id: 2, propertyId: GITE, start: '2026-10-29', end: '2026-11-03', inTime: '13:00', name: 'Jean-Baptiste Fontaine' });
  const { arrivals, departures } = buildModel(db).alertsInRange(WINDOW);
  assert.deepEqual(arrivals[2], { type: 'red', explanation: 'Marie Durand part le 29/10/2026 à 10:00, ménage: 4h' });
  assert.equal(departures[1].type, 'red');
  assert.equal(departures[1].cleaningDisplay, '4h');
  assert.match(departures[1].explanation, /^Arrivée de Jean-Baptiste Fontaine 29\/10\/2026 à 13:00/);
});

test('F2 — two logements leaving the same day at the same real time raise « Départs simultanés » on both departure rows', () => {
  const db = freshDb();
  stay(db, { id: 3, propertyId: TENTE, start: '2026-10-28', end: '2026-10-31', outTime: '10:00' });
  stay(db, { id: 4, propertyId: STUDIO, start: '2026-10-29', end: '2026-10-31', outTime: '10:00' });
  stay(db, { id: 5, propertyId: CABANE, start: '2026-10-28', end: '2026-10-31', outTime: '11:00' });
  const { arrivals, departures } = buildModel(db).alertsInRange(WINDOW);
  assert.equal(departures[3]?.type, 'orange');
  assert.equal(departures[4]?.type, 'orange');
  assert.equal(departures[5], undefined, 'an 11:00 departure is not simultaneous with 10:00 ones');
  assert.equal(arrivals[3], undefined, 'the departure alert never lands on the arrival card');
});

test('F3 — no blue alert when the other logements are already clean at the arrival (real checkout + cleaning hours)', () => {
  const db = freshDb();
  stay(db, { id: 3, propertyId: TENTE, start: '2026-10-28', end: '2026-10-31', outTime: '10:00' }); // clean at 12:00
  stay(db, { id: 4, propertyId: STUDIO, start: '2026-10-28', end: '2026-10-31', outTime: '10:00' }); // clean at 11:00
  stay(db, { id: 6, propertyId: CABANE, start: '2026-10-31', end: '2026-11-02', inTime: '12:30' });
  const { arrivals } = buildModel(db).alertsInRange(WINDOW);
  assert.equal(arrivals[6], undefined);
});

test('rule 2 — a blue alert when another logement is still being cleaned at the arrival', () => {
  const db = freshDb();
  stay(db, { id: 3, propertyId: TENTE, start: '2026-10-28', end: '2026-10-31', outTime: '10:00' }); // clean at 12:00
  stay(db, { id: 6, propertyId: CABANE, start: '2026-10-31', end: '2026-11-02', inTime: '11:30' });
  const { arrivals } = buildModel(db).alertsInRange(WINDOW);
  assert.deepEqual(arrivals[6], { type: 'blue', explanation: "Arrivée pendant nettoyage d'un autre logement" });
});

test('F4 — an alert belongs to one card: the arrival card of a stay never carries its departure turnover', () => {
  const db = freshDb();
  stay(db, { id: 1, propertyId: GITE, start: '2026-10-27', end: '2026-10-29', name: 'Marie Durand' });
  stay(db, { id: 2, propertyId: GITE, start: '2026-10-29', end: '2026-11-03', inTime: '13:00', name: 'Jean Fontaine' });
  const { arrivals, departures } = buildModel(db).alertsInRange(WINDOW);
  assert.equal(arrivals[1], undefined, "Marie's arrival card has no alert");
  assert.equal(departures[2], undefined, "Jean's departure row has no alert");
  assert.equal(arrivals[2].type, 'red');
  assert.equal(departures[1].type, 'red');
});

test('rule 1 — exact fit is fine, an overrun is red; days apart never conflict', () => {
  const run = (cleaning, arrivalDate, arrivalTime) => computePlanningAlerts({
    stays: [
      { id: 1, propertyId: 9, startDate: '2025-12-28', endDate: '2026-01-01', checkInTime: '15:00', checkOutTime: '10:00' },
      { id: 2, propertyId: 9, startDate: arrivalDate, endDate: '2026-01-20', checkInTime: arrivalTime, checkOutTime: '10:00' },
    ],
    cleaningHoursByProperty: { 9: cleaning },
    from: '2025-12-20', to: '2026-01-31',
  }).arrivals[2];
  assert.equal(run(2, '2026-01-01', '12:00'), undefined);
  assert.equal(run(3, '2026-01-01', '12:00').type, 'red');
  assert.equal(run(3, '2026-01-10', '10:00'), undefined);
});

test('rule 1 — half hours read « 1h5 »; cancelled stays and devis are ignored; a stay with no client uses its iCal summary', () => {
  const db = freshDb();
  db.prepare('UPDATE properties SET cleaningHours = 1.5 WHERE id = ?').run(STUDIO);
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, startDate, endDate, checkInTime, checkOutTime, icalOriginalSummary)
              VALUES (10, 'reservation', ?, '2026-10-26', '2026-10-30', '15:00', '10:00', 'Airbnb (Not available)')`).run(STUDIO);
  stay(db, { id: 11, propertyId: STUDIO, start: '2026-10-30', end: '2026-11-01', inTime: '11:00' });
  stay(db, { id: 12, propertyId: TENTE, start: '2026-10-26', end: '2026-10-30', kind: 'cancelled' });
  stay(db, { id: 13, propertyId: TENTE, start: '2026-10-30', end: '2026-11-01', inTime: '11:45' });
  const { arrivals } = buildModel(db).alertsInRange(WINDOW);
  assert.equal(arrivals[11].explanation, 'Airbnb (Not available) part le 30/10/2026 à 10:00, ménage: 1h5');
  assert.equal(arrivals[13], undefined);
});
