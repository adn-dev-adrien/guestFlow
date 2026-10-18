const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const upcomingModel = require('../models/upcomingReservationsModel');
const { groupArrivalsByDay, frenchDayLabel } = require('../utils/upcomingArrivals');
const { buildController } = require('../controllers/upcomingReservationsController');

// specs/upcoming-reservations-cards.md rule 6 — « Réservations à venir » is ONE call: the server lists
// the arrivals from today on, details each one and groups them by day, labelled and counted. The page
// used to send one request per stay and could exhaust the API rate limit (review #8, m-9).

const DDL = `
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, checkInTime TEXT
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  return { db, model: upcomingModel.create(db) };
}

function add(db, id, startDate, { kind = 'reservation', checkInTime = null, clientId = 1 } = {}) {
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime)
              VALUES (?, ?, 1, ?, ?, date(?, '+2 days'), ?)`).run(id, kind, clientId, startDate, startDate, checkInTime);
}

test('rule 6 — the arrivals from today on, by day then check-in time, an unset time last', () => {
  const { db, model } = freshModel();
  add(db, 1, '2026-10-17');
  add(db, 2, '2026-10-19', { checkInTime: '18:00' });
  add(db, 3, '2026-10-18');
  add(db, 4, '2026-10-19', { checkInTime: '15:00' });
  add(db, 5, '2026-10-19', { checkInTime: '' });
  add(db, 6, '2026-10-18', { checkInTime: '16:00' });
  assert.deepEqual(model.arrivalIdsFrom('2026-10-18'), [6, 3, 4, 2, 5]);
});

test('rule 6 — a devis, a cancelled stay or an orphan reservation is not an arrival', () => {
  const { db, model } = freshModel();
  add(db, 1, '2026-10-20', { kind: 'devis' });
  add(db, 2, '2026-10-20', { kind: 'cancelled' });
  add(db, 3, '2026-10-20', { clientId: 99 });
  add(db, 4, '2026-10-20');
  assert.deepEqual(model.arrivalIdsFrom('2026-10-18'), [4]);
});

test('rule 6 — the days come grouped, labelled in French, flagged today and counted', () => {
  const payload = groupArrivalsByDay([
    { id: 1, startDate: '2026-10-18', checkInReady: 1 },
    { id: 2, startDate: '2026-10-18', checkInReady: 0 },
    { id: 3, startDate: '2026-10-23', checkInReady: true },
  ], '2026-10-18');
  assert.equal(payload.today, '2026-10-18');
  assert.deepEqual(payload.days.map(({ reservations, ...day }) => ({ ...day, ids: reservations.map((r) => r.id) })), [
    { date: '2026-10-18', label: 'dimanche 18 octobre', isToday: true, readyCount: 1, total: 2, allReady: false, ids: [1, 2] },
    { date: '2026-10-23', label: 'vendredi 23 octobre', isToday: false, readyCount: 1, total: 1, allReady: true, ids: [3] },
  ]);
});

test('rule 6 — the label does not depend on the server time zone', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(frenchDayLabel('2026-10-25'), 'dimanche 25 octobre');
  } finally {
    process.env.TZ = before;
  }
});

test('rule 6 — one response carries every detailed arrival, whatever their number', () => {
  const ids = Array.from({ length: 500 }, (_, i) => i + 1);
  const asked = [];
  const controller = buildController({
    model: { arrivalIdsFrom: (day) => { asked.push(day); return ids; } },
    detailOf: (id) => (id === 7 ? null : { id, startDate: '2026-11-02', checkInReady: 0, options: [] }),
    today: () => '2026-10-18',
  });
  let body = null;
  controller.upcoming({}, { json: (b) => { body = b; } });
  assert.deepEqual(asked, ['2026-10-18']);
  assert.equal(body.today, '2026-10-18');
  assert.equal(body.days.length, 1);
  assert.equal(body.days[0].total, 499);
  assert.ok(body.days[0].reservations.every((r) => r.id !== 7));
});
