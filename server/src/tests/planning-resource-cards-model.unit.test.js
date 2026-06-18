const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/planningResourceCardsModel');

// specs/resource-hourly-scheduling.md §3.4 — one planning card per session of a showsPlanningCard resource.
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, showsPlanningCard INTEGER DEFAULT 0);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER, icalOriginalSummary TEXT);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, sessions TEXT, PRIMARY KEY (reservationId, resourceId));
  `);
  db.prepare("INSERT INTO resources (id, name, showsPlanningCard) VALUES (1, 'Bain nordique', 1)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO reservations (id, clientId, propertyId) VALUES (1, 1, 1)").run();
  return db;
}

test('cardsInRange: one card per session within the window', () => {
  const db = makeDb();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, sessions) VALUES (1, 1, ?)').run(JSON.stringify([
    { date: '2026-07-11', start: '19:00', end: '21:00', done: false },
    { date: '2026-07-12', start: '14:00', end: '15:00', done: true },
    { date: '2026-07-20', start: '10:00', end: '11:00', done: false }, // out of window
  ]));
  const model = buildModel(db);
  const out = model.cardsInRange({ from: '2026-07-10', to: '2026-07-13' });
  assert.deepEqual(Object.keys(out).sort(), ['2026-07-11', '2026-07-12']);
  const card = out['2026-07-11'].items[0];
  assert.equal(card.name, 'Bain nordique');
  assert.equal(card.clientName, 'Jean Dupont');
  assert.equal(card.propertyName, 'Gîte');
  assert.equal(card.start, '19:00');
  assert.equal(card.end, '21:00');
  assert.equal(out['2026-07-12'].items[0].done, true);
});

test('setSessionDone: toggles one session matched by date + start', () => {
  const db = makeDb();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, sessions) VALUES (1, 1, ?)').run(JSON.stringify([
    { date: '2026-07-11', start: '19:00', end: '21:00', done: false },
  ]));
  const model = buildModel(db);
  const res = model.setSessionDone({ reservationId: 1, resourceId: 1, date: '2026-07-11', start: '19:00', done: true });
  assert.equal(res.ok, true);
  const stored = JSON.parse(db.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = 1 AND resourceId = 1').get().sessions);
  assert.equal(stored[0].done, true);
});

test('setSessionDone: unknown session → 404-ish error', () => {
  const db = makeDb();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, sessions) VALUES (1, 1, ?)').run(JSON.stringify([
    { date: '2026-07-11', start: '19:00', end: '21:00', done: false },
  ]));
  const model = buildModel(db);
  assert.equal(model.setSessionDone({ reservationId: 1, resourceId: 1, date: '2026-07-11', start: '08:00', done: true }).error, 'SESSION_NOT_FOUND');
});
