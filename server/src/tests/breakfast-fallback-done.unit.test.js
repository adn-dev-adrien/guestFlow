const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel: buildBreakfastModel } = require('../models/breakfastModel');
const { buildModel: buildOptionCardsModel } = require('../models/planningOptionCardsModel');
const { buildController } = require('../controllers/planningController');

// specs/breakfast-option-planning-card.md — rule added at the 2026-10-27 spec review (F5): a breakfast
// sold without chosen mornings shows a card every morning (fallback) and its « préparé » toggle must
// work; it used to answer 404 OCCURRENCE_NOT_FOUND.

const DDL = `
  CREATE TABLE breakfast_fallback_done (
    reservationId INTEGER NOT NULL, date TEXT NOT NULL, createdAt TEXT, PRIMARY KEY (reservationId, date)
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER,
    clientId INTEGER,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    adults INTEGER DEFAULT 0,
    teens INTEGER DEFAULT 0,
    children INTEGER DEFAULT 0,
    babies INTEGER DEFAULT 0,
    breakfastTime TEXT,
    breakfastCoffee INTEGER NOT NULL DEFAULT 0,
    breakfastTea INTEGER NOT NULL DEFAULT 0,
    breakfastChocolate INTEGER NOT NULL DEFAULT 0,
    breakfastMilk INTEGER NOT NULL DEFAULT 0,
    breakfastPastries INTEGER NOT NULL DEFAULT 0,
    breakfastCereals INTEGER NOT NULL DEFAULT 0,
    breakfastBread REAL NOT NULL DEFAULT 0,
    breakfastNotifiedDate TEXT,
    arrivalSasDoneAt TEXT,
    breakfastNote TEXT
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT, lastName TEXT
  );
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    autoOptionType TEXT,
    breakfastTime TEXT,
    breakfastNotifyLeadMinutes INTEGER NOT NULL DEFAULT 30,
    showsPlanningCard INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    quantity REAL DEFAULT 1,
    cardOccurrences TEXT,
    cardPersons REAL,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE property_option_defaults (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (propertyId, optionId)
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO options (id, title, autoOptionType, breakfastTime, showsPlanningCard) VALUES (1, 'Petit déjeuner', 'breakfast', '09:00', 1)").run();
  db.prepare("INSERT INTO options (id, title, autoOptionType) VALUES (2, 'Repas', NULL)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (10, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (100, 'Jean', 'Fontaine')").run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults)
              VALUES (2, 10, 100, '2026-10-29', '2026-11-03', 2)`).run();
  return db;
}

function controllerFor(db) {
  return buildController({ breakfastModel: buildBreakfastModel(db), planningOptionCardsModel: buildOptionCardsModel(db) });
}

function call(handler, body) {
  let status = 200; let payload;
  handler({ body }, { status(s) { status = s; return this; }, json(p) { payload = p; return this; } });
  return { status, payload };
}

test('a fallback breakfast card (no chosen mornings) can be ticked and unticked, morning by morning', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (2, 1, 1)').run();
  const controller = controllerFor(db);
  const done = call(controller.setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-10-30', time: '09:00', done: true });
  assert.equal(done.status, 200);
  assert.deepEqual(done.payload, { ok: true, done: true });

  const cards = buildBreakfastModel(db).breakfastByDate({ from: '2026-10-30', to: '2026-10-31' });
  assert.equal(cards['2026-10-30'].items[0].done, true);
  assert.equal(cards['2026-10-31'].items[0].done, false, 'only that morning is ticked');

  call(controller.setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-10-30', time: '09:00', done: false });
  assert.equal(buildBreakfastModel(db).breakfastByDate({ from: '2026-10-30', to: '2026-10-30' })['2026-10-30'].items[0].done, false);
});

test('a property-default breakfast (no reservation option row at all) can be ticked too', () => {
  const db = freshDb();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId) VALUES (10, 1)').run();
  const res = call(controllerFor(db).setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-11-01', time: '09:00', done: true });
  assert.equal(res.status, 200);
  assert.equal(buildBreakfastModel(db).breakfastByDate({ from: '2026-11-01', to: '2026-11-01' })['2026-11-01'].items[0].done, true);
});

test('no card that morning → still 404: arrival morning, a morning outside the stay, a non-breakfast option', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (2, 1, 1)').run();
  const controller = controllerFor(db);
  assert.equal(call(controller.setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-10-29', time: '09:00', done: true }).status, 404);
  assert.equal(call(controller.setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-11-04', time: '09:00', done: true }).status, 404);
  assert.equal(call(controller.setOptionCardDone, { reservationId: 2, optionId: 2, date: '2026-10-30', time: '09:00', done: true }).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM breakfast_fallback_done').get().n, 0);
});

test('chosen mornings keep their own flag: a morning that was not chosen is not a fallback card', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, cardOccurrences) VALUES (2, 1, 1, ?)')
    .run(JSON.stringify([{ date: '2026-10-31', time: '08:30', done: false }]));
  const controller = controllerFor(db);
  assert.equal(call(controller.setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-10-30', time: '09:00', done: true }).status, 404);
  assert.equal(call(controller.setOptionCardDone, { reservationId: 2, optionId: 1, date: '2026-10-31', time: '08:30', done: true }).status, 200);
});
