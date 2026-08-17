// specs/sas-breakfast-time-applies.md — the breakfast hour set in the check-in SAS must actually apply.
//
// Operator report (issue #426): « Si on change l'heure du petit déj dans la SAS Check in ce n'est pas
// pris en compte. » Since the breakfast planning cards shipped, the hour lives in TWO places: the
// reservation (`reservations.breakfastTime`) and each served morning (the `time` of the breakfast
// option's `cardOccurrences`). The card, the sort and the push notice read the OCCURRENCE, so an hour
// that only landed on the reservation was invisible.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const breakfastModel = require('../models/breakfastModel');

const BREAKFAST_OPTION = 6;

function makeDb({ occurrences } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT,
      breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', breakfastTime TEXT, showsPlanningCard INTEGER DEFAULT 0);
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, cardOccurrences TEXT, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
    CREATE TABLE property_option_defaults (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  `);
  db.prepare("INSERT INTO properties (id, name, defaultCautionAmount) VALUES (7, 'Gite', 500)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare(`INSERT INTO options (id, title, autoOptionType, breakfastTime, showsPlanningCard)
              VALUES (${BREAKFAST_OPTION}, 'Petit déjeuner', 'breakfast', '09:00', 1)`).run();
  db.prepare(`INSERT INTO reservations (id, clientId, propertyId, startDate, endDate, adults)
              VALUES (1, 1, 7, '2026-07-10', '2026-07-13', 2)`).run();
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, cardOccurrences)
              VALUES (1, ${BREAKFAST_OPTION}, 1, ?)`)
    .run(occurrences === undefined ? JSON.stringify([
      { date: '2026-07-11', time: '09:00', done: false },
      { date: '2026-07-12', time: '09:00', done: true },
      { date: '2026-07-13', time: '09:00', done: false },
    ]) : occurrences);
  return db;
}

const occurrencesOf = (db) => JSON.parse(
  db.prepare(`SELECT cardOccurrences FROM reservation_options WHERE reservationId = 1 AND optionId = ${BREAKFAST_OPTION}`).get().cardOccurrences || '[]',
);
const reservationTime = (db) => db.prepare('SELECT breakfastTime FROM reservations WHERE id = 1').get().breakfastTime;

test('REGRESSION: the hour set in the check-in SAS reaches every breakfast morning of the stay', () => {
  const db = makeDb();
  createReservationsModel(db).commitArrivalSas(1, { breakfastTime: '08:30' });

  assert.equal(reservationTime(db), '08:30');
  assert.deepEqual(occurrencesOf(db).map((o) => o.time), ['08:30', '08:30', '08:30'],
    'the planning card + the push notice read the occurrence — that is what had to move');
});

test('the « done » flags and the dates survive the rewrite', () => {
  const db = makeDb();
  createReservationsModel(db).commitArrivalSas(1, { breakfastTime: '07:45' });
  assert.deepEqual(occurrencesOf(db), [
    { date: '2026-07-11', time: '07:45', done: false },
    { date: '2026-07-12', time: '07:45', done: true },
    { date: '2026-07-13', time: '07:45', done: false },
  ]);
});

test('clearing the hour puts the mornings back on the option default', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { breakfastTime: '08:30' });
  model.commitArrivalSas(1, { breakfastTime: '' });
  assert.equal(reservationTime(db), null, 'NULL = « use the option default »');
  assert.deepEqual(occurrencesOf(db).map((o) => o.time), ['09:00', '09:00', '09:00']);
});

test('a commit that does not carry the hour leaves the mornings alone', () => {
  const db = makeDb();
  createReservationsModel(db).commitArrivalSas(1, { cautionReceived: true });
  assert.deepEqual(occurrencesOf(db).map((o) => o.time), ['09:00', '09:00', '09:00']);
  assert.equal(reservationTime(db), null);
});

test('a stay with no stored occurrence still records the hour (legacy reservation)', () => {
  const db = makeDb({ occurrences: null });
  createReservationsModel(db).commitArrivalSas(1, { breakfastTime: '08:00' });
  assert.equal(reservationTime(db), '08:00');
  assert.deepEqual(occurrencesOf(db), [], 'nothing to rewrite — the card falls back to the reservation hour');
});

test('breakfastModel serves the new hour on the planning card AND in the SAS payload', () => {
  const db = makeDb();
  createReservationsModel(db).commitArrivalSas(1, { breakfastTime: '08:30' });
  const model = breakfastModel.buildModel(db);

  const byDate = model.breakfastByDate({ from: '2026-07-10', to: '2026-07-14' });
  assert.deepEqual(Object.keys(byDate).sort(), ['2026-07-11', '2026-07-12', '2026-07-13']);
  for (const date of Object.keys(byDate)) {
    assert.equal(byDate[date].items[0].breakfastTime, '08:30', `card of ${date} still on the old hour`);
  }
  assert.equal(model.getForReservation(1).time, '08:30', 'and the SAS reopens on the hour it recorded');
});
