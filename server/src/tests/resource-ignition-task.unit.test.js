// specs/resource-ignition-task.md — a resource that takes hours to warm up (le bain nordique) needs a
// « Démarrer » task on the planning of the day it must be lit. Issue #13: a morning session has to be
// started the night before; an afternoon one is lit the same morning and needs no reminder.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/planningResourceCardsModel');

const HOT_TUB = 2;

function makeModel({ heatUpMinutes = 480, heatRetentionMinutes = 0, sessions = [] } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT, showsPlanningCard INTEGER DEFAULT 0,
      heatUpMinutes INTEGER NOT NULL DEFAULT 0, heatRetentionMinutes INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, sessions TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER, icalOriginalSummary TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare('INSERT INTO resources (id, name, showsPlanningCard, heatUpMinutes, heatRetentionMinutes) VALUES (?, ?, 1, ?, ?)')
    .run(HOT_TUB, 'Bain nordique', heatUpMinutes, heatRetentionMinutes);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO reservations (id, clientId, propertyId) VALUES (1, 1, 1)").run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, sessions) VALUES (1, ?, ?)')
    .run(HOT_TUB, JSON.stringify(sessions));
  return { model: buildModel(db), db };
}

const RANGE = { from: '2026-08-01', to: '2026-08-31' };
const ignitionsOn = (cards, date) => (cards[date]?.items || []).filter((i) => i.kind === 'ignition');
const kindsOn = (cards, date) => (cards[date]?.items || []).map((i) => i.kind);

test('a morning session is lit the night before (issue #13)', () => {
  const { model } = makeModel({ sessions: [{ date: '2026-08-10', start: '09:00', end: '10:00' }] });
  const cards = model.cardsInRange(RANGE);

  const [ignition] = ignitionsOn(cards, '2026-08-09');
  assert.ok(ignition, 'the « démarrer » task lands on the previous day');
  assert.equal(ignition.ignitionAt, '01:00', '09:00 minus 8 h — the small hours');
  assert.equal(ignition.time, null, 'so it sits at the END of the previous day: the evening before');
  assert.equal(ignition.dayOffset, 1);
  assert.equal(ignition.sessionStart, '09:00', 'it says which session it prepares');
  assert.equal(ignition.name, 'Bain nordique');
  assert.equal(ignition.done, false);
  // The session card itself is untouched, on its own day.
  assert.deepEqual(kindsOn(cards, '2026-08-10'), ['session']);
});

test('an afternoon session is lit the same morning — no task at all', () => {
  const { model } = makeModel({ sessions: [{ date: '2026-08-10', start: '17:00', end: '18:00' }] });
  const cards = model.cardsInRange(RANGE);
  assert.deepEqual(kindsOn(cards, '2026-08-10'), ['session']);
  assert.equal(ignitionsOn(cards, '2026-08-09').length, 0);
});

test('a resource with no heat-up never produces the task (non-regression)', () => {
  const { model } = makeModel({ heatUpMinutes: 0, sessions: [{ date: '2026-08-10', start: '09:00', end: '10:00' }] });
  const cards = model.cardsInRange(RANGE);
  assert.deepEqual(kindsOn(cards, '2026-08-10'), ['session']);
  assert.deepEqual(Object.keys(cards), ['2026-08-10']);
});

test('a resource still hot from the evening before is not re-lit', () => {
  const { model } = makeModel({
    heatRetentionMinutes: 480, // 8 h
    sessions: [
      { date: '2026-08-09', start: '20:00', end: '21:00' },
      { date: '2026-08-10', start: '09:00', end: '10:00' }, // 12 h later → cold
      { date: '2026-08-10', start: '11:00', end: '12:00' }, // 1 h after the previous one → still hot
    ],
  });
  const cards = model.cardsInRange(RANGE);
  const ignitions = ignitionsOn(cards, '2026-08-09');
  assert.equal(ignitions.length, 1, 'only the genuinely cold session asks for a fire');
  assert.equal(ignitions[0].sessionStart, '09:00');
});

test('an ignition that really falls on an earlier day keeps its own hour', () => {
  // 06:00 session, 8 h of heat-up → 22:00 the day before: a real evening slot, so the card is placed
  // AT 22:00 in that day's stream rather than at its end.
  const { model } = makeModel({ sessions: [{ date: '2026-08-10', start: '06:00', end: '07:00' }] });
  const [ignition] = ignitionsOn(model.cardsInRange(RANGE), '2026-08-09');
  assert.ok(ignition);
  assert.equal(ignition.time, '22:00');
  assert.equal(ignition.dayOffset, 1);
});

test('a heat-up longer than a day lands the task two days before', () => {
  const { model } = makeModel({ heatUpMinutes: 1800, sessions: [{ date: '2026-08-10', start: '02:00', end: '03:00' }] });
  const cards = model.cardsInRange(RANGE);
  const [ignition] = ignitionsOn(cards, '2026-08-08');
  assert.ok(ignition);
  assert.equal(ignition.time, '20:00', '02:00 minus 30 h');
  assert.equal(ignition.dayOffset, 2);
});

test('the task only shows when ITS day is inside the requested window', () => {
  const { model } = makeModel({ sessions: [{ date: '2026-08-10', start: '09:00', end: '10:00' }] });
  // Window starting on the session day: the ignition day (08-09) is outside → not emitted.
  const cards = model.cardsInRange({ from: '2026-08-10', to: '2026-08-31' });
  assert.deepEqual(Object.keys(cards), ['2026-08-10']);
  assert.deepEqual(kindsOn(cards, '2026-08-10'), ['session']);
});

test('ticking the « démarrer » task does not tick the session itself', () => {
  const { model, db } = makeModel({ sessions: [{ date: '2026-08-10', start: '09:00', end: '10:00' }] });
  const stored = () => JSON.parse(db.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = 1').get().sessions)[0];

  model.setSessionDone({ reservationId: 1, resourceId: HOT_TUB, date: '2026-08-10', start: '09:00', done: true, kind: 'ignition' });
  assert.equal(stored().ignitionDone, true);
  assert.ok(!stored().done, 'the session is still to prepare');

  model.setSessionDone({ reservationId: 1, resourceId: HOT_TUB, date: '2026-08-10', start: '09:00', done: true });
  assert.equal(stored().done, true);
  assert.equal(stored().ignitionDone, true, 'and the fire stays lit');

  const cards = model.cardsInRange(RANGE);
  assert.equal(ignitionsOn(cards, '2026-08-09')[0].done, true);
});
