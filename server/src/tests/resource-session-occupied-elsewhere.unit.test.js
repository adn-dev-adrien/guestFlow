// specs/hourly-resource-quantity-and-sas-scheduling.md rules 28 + 34 « and vice versa » — fixed at the
// 2026-10-27 spec review (F6): a fiche session placed on a slot an external booking (or another stay's
// session) already holds on a resource that exists once was saved; it is now refused 409.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { firstSessionConflict, conflictError, sessionKey } = require('../utils/resourceSessionConflicts');
const { buildModel } = require('../models/resourceOtherUsesModel');

const DDL = `
  CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation');
  CREATE TABLE resources (id INTEGER PRIMARY KEY, quantity INTEGER DEFAULT 1, turnoverMinutes INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, sessions TEXT, PRIMARY KEY (reservationId, resourceId));
  CREATE TABLE resource_bookings (id INTEGER PRIMARY KEY, resourceId INTEGER, date TEXT, startTime TEXT, endTime TEXT, reservationId INTEGER);
`;
const BATH = 2;

function freshDb({ turnover = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO resources (id, quantity, turnoverMinutes) VALUES (?, 1, ?)').run(BATH, turnover);
  db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2026-11-07', '19:00', '21:00')").run(BATH);
  db.prepare("INSERT INTO reservations (id) VALUES (5)").run();
  db.prepare("INSERT INTO reservations (id, kind) VALUES (6, 'devis')").run();
  db.prepare('INSERT INTO reservation_resources VALUES (5, ?, ?)').run(BATH, JSON.stringify([{ date: '2026-11-08', start: '10:00', end: '11:00' }]));
  db.prepare('INSERT INTO reservation_resources VALUES (6, ?, ?)').run(BATH, JSON.stringify([{ date: '2026-11-08', start: '14:00', end: '15:00' }]));
  return db;
}

function check(db, sessions, reservationId = null) {
  const model = buildModel(db);
  return firstSessionConflict([{ resourceId: BATH, sessions }], () => 1, {
    occupiedOn: (resourceId, date) => model.occupiedOn({ resourceId, date, excludeReservationId: reservationId }),
    turnoverOf: (resourceId) => model.turnoverOf(resourceId),
    storedOf: (resourceId) => new Set(model.storedSessions({ reservationId, resourceId })
      .map((s) => sessionKey(s.date, s.start, s.end))),
  });
}

test('F6 — a new stay session over an external booking is refused with a French message', () => {
  const conflict = check(freshDb(), [{ date: '2026-11-07', start: '20:00', end: '21:00' }]);
  assert.deepEqual(conflict, { resourceId: BATH, date: '2026-11-07', start: '20:00', end: '21:00', elsewhere: true });
  const body = conflictError(conflict);
  assert.equal(body.code, 'RESOURCE_SLOT_TAKEN');
  assert.equal(body.error, 'Créneau déjà occupé le 7 novembre 2026 à 20:00 : la ressource est réservée par ailleurs.');
});

test("a session over another stay's session is refused; a devis holds no slot", () => {
  const db = freshDb();
  assert.ok(check(db, [{ date: '2026-11-08', start: '10:30', end: '11:30' }]));
  assert.equal(check(db, [{ date: '2026-11-08', start: '14:00', end: '15:00' }]), null);
});

test('free slots, back-to-back uses and the stay editing its own session pass', () => {
  const db = freshDb();
  assert.equal(check(db, [{ date: '2026-11-07', start: '17:00', end: '19:00' }]), null);
  assert.equal(check(db, [{ date: '2026-11-08', start: '10:00', end: '11:00' }], 5), null);
});

test('the turnover keeps the reset time free around an external booking', () => {
  assert.ok(check(freshDb({ turnover: 30 }), [{ date: '2026-11-07', start: '21:00', end: '22:00' }]));
  assert.equal(check(freshDb({ turnover: 30 }), [{ date: '2026-11-07', start: '21:30', end: '22:30' }]), null);
});

test('a session already stored unchanged is not re-judged: an old overlap never locks the fiche', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservations (id) VALUES (7)').run();
  db.prepare('INSERT INTO reservation_resources VALUES (7, ?, ?)').run(BATH, JSON.stringify([{ date: '2026-11-07', start: '20:00', end: '21:00' }]));
  assert.equal(check(db, [{ date: '2026-11-07', start: '20:00', end: '21:00' }], 7), null);
  assert.ok(check(db, [{ date: '2026-11-07', start: '19:30', end: '20:30' }], 7), 'moving it onto the booking is judged');
});

test('without the plugin tables the check is the stay-only one', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT);
           CREATE TABLE resources (id INTEGER PRIMARY KEY, quantity INTEGER);
           CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity INTEGER);`);
  const model = buildModel(db);
  assert.deepEqual(model.occupiedOn({ resourceId: BATH, date: '2026-11-07' }), []);
  assert.equal(model.turnoverOf(BATH), 0);
  assert.deepEqual(model.storedSessions({ reservationId: 1, resourceId: BATH }), []);
});
