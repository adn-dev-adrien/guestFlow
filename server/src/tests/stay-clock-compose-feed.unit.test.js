// specs/pricing-components.md §3 rules 20, 44-46 (class E1, D2) — the clock feeds the engine. The extras baseline COMPOSE reads
// (`arrivalExtrasBaseline`, through `resolveArrivalExtrasBaseline`) exists exactly when the stay clock says the stay has started
// (or a complement is collected): the arrival mark and the arrival SAS no longer route a sale.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

function modelDb({ startDate, endDate, checkInTime = null, checkInDone = 0, arrivalSasDoneAt = null }) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, checkInTime TEXT, checkOutTime TEXT, startDate TEXT, endDate TEXT,
      arrivalExtrasBaseline TEXT, complementPaid INTEGER DEFAULT 0, complementPaidCash INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0,
      arrivalSasDoneAt TEXT, updatedAt TEXT);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL DEFAULT 0, offered INTEGER DEFAULT 0);
  `);
  db.prepare('INSERT INTO reservations (id, startDate, endDate, checkInTime, checkInDone, arrivalSasDoneAt) VALUES (1, ?, ?, ?, ?, ?)')
    .run(startDate, endDate, checkInTime, checkInDone, arrivalSasDoneAt);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice) VALUES (1, 9, 10)').run();
  return db;
}
const day = (n) => addDaysToIsoDate(todayIso(), n);

test('the baseline follows the clock: started and not marked → due; not started and marked → not due', () => {
  const startedUnmarked = createReservationsModel(modelDb({ startDate: day(-1), endDate: day(2) }));
  assert.notEqual(startedUnmarked.resolveArrivalExtrasBaseline(1), null);
  assert.equal(startedUnmarked.arrivalBaselineNotDue(1), false);

  const futureMarked = createReservationsModel(modelDb({ startDate: day(3), endDate: day(5), checkInDone: 1, arrivalSasDoneAt: '2026-01-01 10:00:00' }));
  assert.equal(futureMarked.resolveArrivalExtrasBaseline(1), null);
  assert.equal(futureMarked.arrivalBaselineNotDue(1), true);
});

test('on the arrival day the check-in time decides, not the mark', () => {
  const beforeTime = createReservationsModel(modelDb({ startDate: todayIso(), endDate: day(2), checkInTime: '23:59', checkInDone: 1 }));
  assert.equal(beforeTime.resolveArrivalExtrasBaseline(1), null, 'marked, but 23:59 has not passed');
  const afterTime = createReservationsModel(modelDb({ startDate: todayIso(), endDate: day(2), checkInTime: '00:00' }));
  assert.notEqual(afterTime.resolveArrivalExtrasBaseline(1), null, 'unmarked, but 00:00 has passed');
});

test('a collected complement still closes the question, started or not (rule 21)', () => {
  const db = modelDb({ startDate: day(5), endDate: day(7) });
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  assert.notEqual(createReservationsModel(db).resolveArrivalExtrasBaseline(1), null);
});
