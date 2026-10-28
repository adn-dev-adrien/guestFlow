const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const planningDaysModel = require('../models/planningDaysModel');
const { buildController } = require('../controllers/planningController');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

// specs/dashboard-planning-scroll.md rules 1–3 — GET /api/planning/today: the home's day lists in one
// call, the next arrival when nobody arrives, the same roles as the planning.

const DDL = `
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  return db;
}

function add(db, id, startDate, endDate, { kind = 'reservation', checkInTime = null, checkOutTime = null, clientId = 1 } = {}) {
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime)
              VALUES (?, ?, 1, ?, ?, ?, ?, ?)`).run(id, kind, clientId, startDate, endDate, checkInTime, checkOutTime);
}

const DAY = '2026-10-28';

function controllerOn(db, { today = DAY, detail } = {}) {
  const detailOf = detail || ((id) => ({ id, kind: 'detailed', startDate: 'x', options: [], totalPrice: 100 }));
  return buildController({ planningDaysModel: planningDaysModel.create(db), detailOf, today: () => today });
}

function call(controller, user = { roles: ['admin'] }) {
  let body = null;
  controller.today({ user, query: {} }, { json: (b) => { body = b; return b; } });
  return body;
}

test('rule 1 — the stays ending and starting today, by hour (unset last) then id, devis and cancelled left out', () => {
  const db = freshDb();
  add(db, 1, '2026-10-24', DAY, { checkOutTime: '11:00' });
  add(db, 2, '2026-10-25', DAY);
  add(db, 3, '2026-10-26', DAY, { checkOutTime: '09:00' });
  add(db, 4, '2026-10-26', DAY, { kind: 'devis' });
  add(db, 5, '2026-10-26', DAY, { kind: 'cancelled' });
  add(db, 6, DAY, '2026-11-01', { checkInTime: '18:00' });
  add(db, 7, DAY, '2026-11-02', { checkInTime: '15:00' });
  add(db, 8, DAY, '2026-11-02', { checkInTime: '' });
  add(db, 9, DAY, '2026-11-02', { checkInTime: '15:00' });
  const body = call(controllerOn(db));
  assert.equal(body.today, DAY);
  assert.deepEqual(body.departures.map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(body.arrivals.map((r) => r.id), [7, 9, 6, 8]);
});

test('rule 1 — each stay is in the model read shape, never the fiche payload, one read per stay', () => {
  const db = freshDb();
  add(db, 1, DAY, '2026-11-01');
  const reads = [];
  const body = call(controllerOn(db, { detail: (id) => { reads.push(id); return { id, shape: 'getByIdWithDetails' }; } }));
  assert.deepEqual(body.arrivals, [{ id: 1, shape: 'getByIdWithDetails' }]);
  assert.deepEqual(reads, [1]);
});

test('rule 2 — with no arrival today, the next arrival is the first later day and every stay of it', () => {
  const db = freshDb();
  add(db, 1, '2026-11-13', '2026-11-16');
  add(db, 2, '2026-11-06', '2026-11-09', { checkInTime: '17:00' });
  add(db, 3, '2026-11-06', '2026-11-08', { checkInTime: '15:00' });
  add(db, 4, '2026-11-02', '2026-11-04', { kind: 'devis' });
  const { nextArrival, arrivals } = call(controllerOn(db));
  assert.deepEqual(arrivals, []);
  assert.equal(nextArrival.date, '2026-11-06');
  assert.equal(nextArrival.label, 'vendredi 6 novembre');
  assert.equal(nextArrival.relativeLabel, 'dans 9 jours');
  assert.deepEqual(nextArrival.reservations.map((r) => r.id), [3, 2]);
});

test('rule 2 — « demain » for the next day, no bound on the search, the year when it is not this year', () => {
  const db = freshDb();
  add(db, 1, '2026-10-29', '2026-10-31');
  assert.equal(call(controllerOn(db)).nextArrival.relativeLabel, 'demain');

  const later = freshDb();
  add(later, 1, '2027-04-03', '2027-04-06');
  const { nextArrival } = call(controllerOn(later));
  assert.equal(nextArrival.label, 'samedi 3 avril 2027');
  assert.equal(nextArrival.relativeLabel, 'dans 157 jours');
});

test('rule 2 — nextArrival is null when today has arrivals, and when nothing starts after today', () => {
  const db = freshDb();
  add(db, 1, DAY, '2026-10-30');
  add(db, 2, '2026-11-06', '2026-11-08');
  assert.equal(call(controllerOn(db)).nextArrival, null);

  const past = freshDb();
  add(past, 1, '2026-10-20', '2026-10-30');
  assert.equal(call(controllerOn(past)).nextArrival, null);
});

test('rule 2 — a stay arriving today never counts as the next arrival of a later day', () => {
  const db = freshDb();
  add(db, 1, '2026-11-06', '2026-11-08');
  assert.equal(call(controllerOn(db, { today: '2026-11-06' })).nextArrival, null);
});

test('rule 3 — a reception-only requester gets the finance-free view with the SAS locks', () => {
  const db = freshDb();
  add(db, 1, DAY, '2026-11-01');
  const detail = (id) => ({
    id, startDate: DAY, endDate: '2026-11-01', firstName: 'Jean', totalPrice: 480, email: 'a@b.c', options: [],
  });
  const reception = call(controllerOn(db, { detail }), { roles: ['reception'] });
  const stay = reception.arrivals[0];
  assert.equal(stay.firstName, 'Jean');
  assert.equal(stay.totalPrice, undefined);
  assert.equal(stay.email, undefined);
  assert.ok('arrivalSasLock' in stay);
  assert.ok('checkInStatusEditable' in stay);
  const admin = call(controllerOn(db, { detail }), { roles: ['admin'] });
  assert.equal(admin.arrivals[0].totalPrice, 480);
});

test('rule 3 — the route sits under /planning/: reception reads it, an accountant gets 403', () => {
  const run = (roles) => {
    let status = 200;
    let nextCalled = false;
    enforceRoleAccess(
      { user: { roles }, method: 'GET', path: '/planning/today' },
      { status(c) { status = c; return this; }, json() { return this; } },
      () => { nextCalled = true; },
    );
    return { status, nextCalled };
  };
  assert.equal(run(['reception']).nextCalled, true);
  assert.equal(run(['admin']).nextCalled, true);
  assert.deepEqual(run(['accountant']), { status: 403, nextCalled: false });
});
