// specs/pricing-components.md §3 rule 44 — `phaseForReservation` is the one resolver: it reads the reservation, then the
// property's `defaultCheckIn` / `defaultCheckOut`, then 15:00 / 10:00, and answers through `phaseOf`.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const stayClockModel = require('../models/stayClockModel');
const { phaseOf } = require('../utils/pricing/stayClock');

const START = '2027-06-10'; // date-literal-ok: pure function input, nothing compares with today
const END = '2027-06-12'; // date-literal-ok: pure function input, nothing compares with today

function fresh() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, defaultCheckIn TEXT, defaultCheckOut TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT);
  `);
  return db;
}
const stay = (db, id, propertyId, checkIn, checkOut) => db
  .prepare('INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (?, ?, ?, ?, ?, ?)')
  .run(id, propertyId, START, END, checkIn, checkOut);
const property = (db, id, checkIn, checkOut) => db.prepare('INSERT INTO properties (id, defaultCheckIn, defaultCheckOut) VALUES (?, ?, ?)').run(id, checkIn, checkOut);
const at = (iso) => new Date(iso);

test('rule 44 — the reservation\'s own times win over the property\'s', () => {
  const db = fresh();
  property(db, 1, '16:00', '11:00');
  stay(db, 1, 1, '18:00', '09:00');
  const model = stayClockModel.create(db);
  assert.deepEqual(model.phaseInputsFor(1), { arrivalDate: START, departureDate: END, checkInTime: '18:00', checkOutTime: '09:00' });
  assert.equal(model.phaseForReservation(1, at('2027-06-10T17:59:00+02:00')).phase, 'before'); // date-literal-ok: pure function input
  assert.equal(model.phaseForReservation(1, at('2027-06-10T18:00:00+02:00')).phase, 'during'); // date-literal-ok: pure function input
});

test('rule 44 — a missing reservation time reads the property default, then 15:00 / 10:00', () => {
  const db = fresh();
  property(db, 1, '16:00', '11:00');
  property(db, 2, null, '');
  stay(db, 1, 1, null, '');
  stay(db, 2, 2, null, null);
  stay(db, 3, 99, '  ', null);
  const model = stayClockModel.create(db);
  assert.deepEqual(model.phaseInputsFor(1), { arrivalDate: START, departureDate: END, checkInTime: '16:00', checkOutTime: '11:00' });
  assert.deepEqual(model.phaseInputsFor(2), { arrivalDate: START, departureDate: END, checkInTime: '15:00', checkOutTime: '10:00' });
  assert.deepEqual(model.phaseInputsFor(3), { arrivalDate: START, departureDate: END, checkInTime: '15:00', checkOutTime: '10:00' });
  assert.equal(model.phaseForReservation(1, at('2027-06-10T15:30:00+02:00')).phase, 'before'); // date-literal-ok: pure function input
  assert.equal(model.phaseForReservation(2, at('2027-06-10T15:00:00+02:00')).phase, 'during'); // date-literal-ok: pure function input
});

test('rule 44 — the answer is the pure unit\'s, for the very same inputs', () => {
  const db = fresh();
  property(db, 1, '16:00', '11:00');
  stay(db, 1, 1, null, null);
  const model = stayClockModel.create(db);
  const now = at('2027-06-12T10:59:00+02:00'); // date-literal-ok: pure function input
  assert.deepEqual(model.phaseForReservation(1, now), phaseOf(model.phaseInputsFor(1), now));
  assert.equal(model.phaseForReservation(1, now).phase, 'during');
});

test('rule 44 — an unknown stay answers null; an unreadable stored time falls back to the property default, it does not throw', () => {
  const db = fresh();
  property(db, 1, '16:00', '11:00');
  stay(db, 1, 1, '9h', null);
  const model = stayClockModel.create(db);
  assert.equal(model.phaseForReservation(404, at('2027-06-10T12:00:00+02:00')), null); // date-literal-ok: pure function input
  assert.equal(model.phaseInputsFor(1).checkInTime, '16:00');
  assert.equal(model.phaseForReservation(1, at('2027-06-10T12:00:00+02:00')).phase, 'before'); // date-literal-ok: pure function input
});

test('rule 44 — the resolver is the only reader of the property default times for the phase', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'models', 'stayClockModel.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /Date\.now\s*\(|new Date\(\s*\)/);
});

test('rule 44 — a stored time is normalised (`9:00`, `09:00:00`), an unreadable one is a time nobody entered', () => {
  const db = fresh();
  property(db, 1, '16:00', '11:00');
  property(db, 2, 'abc', '9h');
  property(db, 3, '9:30', '10:15:00');
  stay(db, 1, 1, '9:00', '09:00:00');
  stay(db, 2, 1, 'abc', '24:00');
  stay(db, 3, 2, 'xx', '');
  stay(db, 4, 3, null, null);
  const model = stayClockModel.create(db);
  assert.deepEqual([model.phaseInputsFor(1).checkInTime, model.phaseInputsFor(1).checkOutTime], ['09:00', '09:00']);
  assert.deepEqual([model.phaseInputsFor(2).checkInTime, model.phaseInputsFor(2).checkOutTime], ['16:00', '11:00'], 'unreadable: the property default');
  assert.deepEqual([model.phaseInputsFor(3).checkInTime, model.phaseInputsFor(3).checkOutTime], ['15:00', '10:00'], 'unreadable property default: 15:00 / 10:00');
  assert.deepEqual([model.phaseInputsFor(4).checkInTime, model.phaseInputsFor(4).checkOutTime], ['09:30', '10:15'], 'a stored default is normalised too');
  assert.doesNotThrow(() => model.phaseForReservation(2, new Date('2027-06-10T16:00:00+02:00'))); // date-literal-ok: pure function input
});
