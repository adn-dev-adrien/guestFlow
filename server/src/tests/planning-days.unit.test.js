const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('node:http');

const planningDaysModel = require('../models/planningDaysModel');
const { buildController } = require('../controllers/planningController');
const { windowDays, checkWindow, MAX_WINDOW_DAYS } = require('../utils/planningDays');

// specs/dashboard-planning-scroll.md rules 8–10 — GET /api/planning/days: every day of a bounded
// window with its stays, breakfast, option cards and alerts; the replaced reads are gone.

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

function add(db, id, startDate, endDate, { kind = 'reservation', checkInTime = null, checkOutTime = null } = {}) {
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime)
              VALUES (?, ?, 1, 1, ?, ?, ?, ?)`).run(id, kind, startDate, endDate, checkInTime, checkOutTime);
}

function build(db, overrides = {}) {
  return buildController({
    planningDaysModel: planningDaysModel.create(db),
    detailOf: (id) => ({ id, endDate: 'e', startDate: 's', totalPrice: 90 }),
    today: () => '2026-10-28',
    breakfastModel: { breakfastByDate: () => ({}) },
    planningOptionCardsModel: { cardsInRange: () => ({}) },
    planningAlertsModel: { alertsInRange: () => ({ arrivals: {}, departures: {} }) },
    ...overrides,
  });
}

function call(controller, query, user = { roles: ['admin'] }) {
  const out = { status: 200, body: null };
  controller.days({ user, query }, {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
  });
  return out;
}

test('rule 8 — every calendar day of the window comes back, empty ones included, with labels and flags', () => {
  const { body } = call(build(freshDb()), { from: '2026-10-26', to: '2026-10-30' });
  assert.deepEqual(body.days.map((d) => d.date), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.equal(body.today, '2026-10-28');
  assert.deepEqual(body.days.map((d) => [d.isPast, d.isToday]), [[true, false], [true, false], [false, true], [false, false], [false, false]]);
  assert.equal(body.days[2].label, 'mercredi 28 octobre');
  assert.equal(body.days[2].shortLabel, 'mer. 28 oct.');
  assert.deepEqual(body.days[0].arrivals, []);
  assert.equal(body.days[0].breakfast, null);
  assert.equal(body.days[0].optionCards, null);
  assert.equal(body.from, '2026-10-26');
  assert.equal(body.to, '2026-10-30');
});

test('rule 8 — the year is added to both labels outside the current year', () => {
  const days = windowDays('2027-01-01', '2027-01-01', '2026-10-28');
  assert.equal(days[0].label, 'vendredi 1 janvier 2027');
  assert.match(days[0].shortLabel, /2027/);
});

test('rule 8 — stays sit on their start and end day, by hour (unset last) then id, devis and cancelled left out', () => {
  const db = freshDb();
  add(db, 1, '2026-10-26', '2026-10-29', { checkOutTime: '11:00' });
  add(db, 2, '2026-10-27', '2026-10-29', { checkOutTime: '08:00' });
  add(db, 3, '2026-10-29', '2026-11-02', { checkInTime: '17:00' });
  add(db, 4, '2026-10-29', '2026-11-02');
  add(db, 5, '2026-10-29', '2026-11-02', { checkInTime: '15:00' });
  add(db, 6, '2026-10-29', '2026-11-02', { kind: 'devis' });
  const { body } = call(build(db), { from: '2026-10-28', to: '2026-10-30' });
  const day = body.days.find((d) => d.date === '2026-10-29');
  assert.deepEqual(day.departures.map((r) => r.id), [2, 1]);
  assert.deepEqual(day.arrivals.map((r) => r.id), [5, 3, 4]);
  assert.deepEqual(body.days[0].arrivals, []);
});

test('rule 8 — breakfast, option cards and alerts land on their days', () => {
  const alerts = { arrivals: { 3: { kind: 'x' } }, departures: {} };
  const controller = build(freshDb(), {
    breakfastModel: { breakfastByDate: ({ from, to }) => ({ '2026-10-29': { items: [{ from, to }], totalPersons: 2 } }) },
    planningOptionCardsModel: { cardsInRange: () => ({ '2026-10-30': { items: [{ title: 'Massage' }] } }) },
    planningAlertsModel: { alertsInRange: () => alerts },
  });
  const { body } = call(controller, { from: '2026-10-28', to: '2026-10-30' });
  assert.deepEqual(body.days.map((d) => [d.breakfast && d.breakfast.totalPersons, d.optionCards && d.optionCards.items[0].title]),
    [[null, null], [2, null], [null, 'Massage']]);
  assert.deepEqual(body.days[1].breakfast.items, [{ from: '2026-10-28', to: '2026-10-30' }]);
  assert.equal(body.alerts, alerts);
});

test('rule 8 — a reception account gets the finance-free view of the window stays', () => {
  const db = freshDb();
  add(db, 1, '2026-10-29', '2026-10-31');
  const detailOf = (id) => ({ id, startDate: '2026-10-29', endDate: '2026-10-31', firstName: 'Jean', totalPrice: 90 });
  const stay = call(build(db, { detailOf }), { from: '2026-10-29', to: '2026-10-29' }, { roles: ['reception'] })
    .body.days[0].arrivals[0];
  assert.equal(stay.totalPrice, undefined);
  assert.ok('arrivalSasLock' in stay);
});

test('rule 8 — a stay is read once per request even when it starts and ends in the window', () => {
  const db = freshDb();
  add(db, 1, '2026-10-29', '2026-10-31');
  const reads = [];
  call(build(db, { detailOf: (id) => { reads.push(id); return { id }; } }), { from: '2026-10-28', to: '2026-11-01' });
  assert.deepEqual(reads, [1]);
});

test('rule 9 — a malformed, unreal, reversed or over-long window is refused with INVALID_DATE_RANGE', () => {
  const controller = build(freshDb());
  const bad = [
    {},
    { from: '2026-10-28' },
    { from: 'x', to: 'y' },
    { from: '2026-02-30', to: '2026-03-05' },
    { from: '2026-10-30', to: '2026-10-28' },
    { from: '2026-10-01', to: '2026-11-01' },
  ];
  for (const query of bad) {
    const res = call(controller, query);
    assert.equal(res.status, 400, JSON.stringify(query));
    assert.deepEqual(res.body, { error: 'INVALID_DATE_RANGE' });
  }
});

test('rule 9 — 31 days are accepted, 32 are not; a past window is answered like a future one', () => {
  assert.equal(MAX_WINDOW_DAYS, 31);
  assert.equal(checkWindow('2026-10-01', '2026-10-31'), null);
  assert.equal(checkWindow('2026-10-01', '2026-11-01'), 'INVALID_DATE_RANGE');
  const past = call(build(freshDb()), { from: '2025-01-01', to: '2025-01-14' });
  assert.equal(past.status, 200);
  assert.equal(past.body.days.length, 14);
  assert.ok(past.body.days.every((d) => d.isPast && !d.isToday));
});

test('rule 9 — the window is counted on the calendar over the leap day and the autumn clock change', () => {
  assert.deepEqual(windowDays('2028-02-28', '2028-03-01', '2028-01-01').map((d) => d.date), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.equal(windowDays('2026-10-24', '2026-10-27', '2026-10-28').length, 4);
});

test('rule 10 — /alerts and /option-cards are gone, breakfast and the option-card tick stay', async () => {
  const router = require('../routes/planning');
  const app = express();
  app.use(express.json());
  app.use('/api/planning', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/planning`;
  try {
    assert.equal((await fetch(`${base}/alerts?from=2026-10-01&to=2026-10-02`)).status, 404);
    assert.equal((await fetch(`${base}/option-cards?from=2026-10-01&to=2026-10-02`)).status, 404);
    assert.equal((await fetch(`${base}/breakfast?from=x&to=y`)).status, 400);
    assert.equal((await fetch(`${base}/option-cards/done`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
