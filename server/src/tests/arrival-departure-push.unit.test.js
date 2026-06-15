const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { runArrivalDeparturePush } = require('../utils/arrivalDeparturePushRunner');

// specs/pwa-push-notifications.md §3.3 + §3.4 — due arrivals/departures detection, send + stamp once,
// and the first-run back-stamp (no restart flood).

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, arrivalNotifiedAt TEXT, departureNotifiedAt TEXT
    );
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  return db;
}

function addRes(db, o) {
  const cols = ['id', 'kind', 'clientId', 'propertyId', 'startDate', 'endDate', 'checkInTime', 'checkOutTime'];
  const vals = cols.map((c) => (o[c] !== undefined ? o[c] : (c === 'kind' ? 'reservation' : null)));
  db.prepare(`INSERT INTO reservations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
}

function stubPush() {
  const calls = [];
  return { calls, sendToPref: async (pref, payload) => { calls.push({ pref, payload }); } };
}

const NOW = new Date(2026, 5, 14, 16, 0, 0); // 2026-06-14 16:00 local
const TODAY = '2026-06-14';

test('dueArrivals: today + check-in reached + not stamped; sends « arrivals » and stamps once', async () => {
  const db = freshDb();
  const model = createReservationsModel(db);
  addRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: TODAY, endDate: '2026-06-18', checkInTime: '15:00' });
  addRes(db, { id: 2, clientId: 1, propertyId: 1, startDate: TODAY, endDate: '2026-06-18', checkInTime: '18:00' }); // not reached yet
  addRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: '2026-06-15', endDate: '2026-06-18', checkInTime: '10:00' }); // another day

  const push = stubPush();
  const res = await runArrivalDeparturePush({ reservationsModel: model, pushService: push, now: NOW });
  assert.equal(res.sent, 1);
  assert.deepEqual(push.calls.map((c) => c.pref), ['arrivals']);
  assert.match(push.calls[0].payload.body, /Jean Dupont · Gîte/);
  assert.equal(push.calls[0].payload.url, '/planning?sas=arrival&reservationId=1');
  // Stamped → a second pass sends nothing.
  const res2 = await runArrivalDeparturePush({ reservationsModel: model, pushService: push, now: NOW });
  assert.equal(res2.sent, 0);
});

test('departures fire on « departures » pref at check-out time', async () => {
  const db = freshDb();
  const model = createReservationsModel(db);
  addRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: '2026-06-10', endDate: TODAY, checkOutTime: '10:00' });
  const push = stubPush();
  const res = await runArrivalDeparturePush({ reservationsModel: model, pushService: push, now: NOW });
  assert.equal(res.sent, 1);
  assert.equal(push.calls[0].pref, 'departures');
  assert.equal(push.calls[0].payload.url, '/planning?sas=departure&reservationId=1');
});

test('firstRun stamps already-due events WITHOUT sending (no restart flood)', async () => {
  const db = freshDb();
  const model = createReservationsModel(db);
  addRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: TODAY, endDate: '2026-06-18', checkInTime: '09:00' });
  addRes(db, { id: 2, clientId: 1, propertyId: 1, startDate: '2026-06-10', endDate: TODAY, checkOutTime: '10:00' });
  const push = stubPush();
  const res = await runArrivalDeparturePush({ reservationsModel: model, pushService: push, now: NOW, firstRun: true });
  assert.equal(res.sent, 0, 'nothing sent on the first run');
  assert.equal(res.stamped, 2, 'both already-due events stamped');
  assert.equal(push.calls.length, 0);
  // Next (normal) pass sends nothing because they were stamped.
  const res2 = await runArrivalDeparturePush({ reservationsModel: model, pushService: push, now: NOW });
  assert.equal(res2.sent, 0);
});
