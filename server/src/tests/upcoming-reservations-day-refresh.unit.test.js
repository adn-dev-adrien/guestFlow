const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const upcomingModel = require('../models/upcomingReservationsModel');
const { buildController } = require('../controllers/upcomingReservationsController');

// specs/upcoming-reservations-cards.md rule 8 — after a « prêt » toggle the page refreshes that one
// day (`?day=`), not the whole season: with 500 stays every click re-read 2.4 MB (review of PR #700).

function freshModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clients (id INTEGER PRIMARY KEY);
    CREATE TABLE properties (id INTEGER PRIMARY KEY);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, propertyId INTEGER, clientId INTEGER, startDate TEXT, checkInTime TEXT);
    INSERT INTO clients (id) VALUES (1);
    INSERT INTO properties (id) VALUES (1);
  `);
  const add = db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, checkInTime) VALUES (?, ?, 1, 1, ?, ?)");
  add.run(1, 'reservation', '2026-10-20', '18:00');
  add.run(2, 'reservation', '2026-10-20', '15:00');
  add.run(3, 'reservation', '2026-10-21', null);
  add.run(4, 'devis', '2026-10-20', null);
  add.run(5, 'reservation', '2026-10-20', null);
  return upcomingModel.create(db);
}

function call(controller, query) {
  const out = { status: 200, body: null };
  controller.upcoming({ query }, {
    status(code) { out.status = code; return this; },
    json(b) { out.body = b; return this; },
  });
  return out;
}

const controllerOn = (model, detailed = []) => buildController({
  model,
  detailOf: (id) => { detailed.push(id); return { id, startDate: id === 3 ? '2026-10-21' : '2026-10-20', checkInReady: id === 2 ? 1 : 0 }; },
  today: () => '2026-10-18',
});

test('rule 8 — one day\'s arrivals, in the same order as the full list', () => {
  assert.deepEqual(freshModel().arrivalIdsOn('2026-10-20'), [2, 1, 5]);
});

test('rule 8 — ?day= details only that day and counts it', () => {
  const detailed = [];
  const { status, body } = call(controllerOn(freshModel(), detailed), { day: '2026-10-20' });
  assert.equal(status, 200);
  assert.deepEqual(detailed, [2, 1, 5]);
  assert.equal(body.today, '2026-10-18');
  assert.deepEqual(body.days.map(({ date, readyCount, total }) => ({ date, readyCount, total })), [
    { date: '2026-10-20', readyCount: 1, total: 3 },
  ]);
});

test('rule 8 — a past day or a day without arrival answers no day', () => {
  assert.deepEqual(call(controllerOn(freshModel()), { day: '2026-10-17' }).body.days, []);
  assert.deepEqual(call(controllerOn(freshModel()), { day: '2026-10-25' }).body.days, []);
});

test('rule 8 — a malformed day is refused', () => {
  const { status, body } = call(controllerOn(freshModel()), { day: '20/10/2026' });
  assert.equal(status, 400);
  assert.equal(body.error, 'Date invalide.');
});
