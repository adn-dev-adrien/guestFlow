// specs/planning-arrival-alerts.md rule 11 (adversarial review of the 2026-10-27 fixes) — a cleaning of
// 1.5 h read « ménage: 1h5 » (now « 1h30 »), and a stay without its own times fell back to 15:00 /
// 10:00 instead of its property's default check-in / check-out.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { computePlanningAlerts, cleaningLabel } = require('../utils/planningArrivalAlerts');

test('a cleaning duration reads hours and minutes', () => {
  assert.equal(cleaningLabel(1.5), '1h30');
  assert.equal(cleaningLabel(2.25), '2h15');
  assert.equal(cleaningLabel(3), '3h');
  assert.equal(cleaningLabel(0.75), '0h45');
});

test('the turnover explanation prints « 1h30 »', () => {
  const out = computePlanningAlerts({
    stays: [
      { id: 1, propertyId: 9, startDate: '2027-07-01', endDate: '2027-07-05', checkInTime: '16:00', checkOutTime: '10:00', lastName: 'A' },
      { id: 2, propertyId: 9, startDate: '2027-07-05', endDate: '2027-07-08', checkInTime: '11:00', checkOutTime: '10:00', lastName: 'B' },
    ],
    cleaningHoursByProperty: { 9: 1.5 },
    from: '2027-07-01', to: '2027-07-10',
  });
  assert.match(out.arrivals[2].explanation, /ménage: 1h30$/);
});

const timeless = [
  { id: 1, propertyId: 9, startDate: '2027-07-01', endDate: '2027-07-05', checkInTime: null, checkOutTime: null, lastName: 'A' },
  { id: 2, propertyId: 9, startDate: '2027-07-05', endDate: '2027-07-08', checkInTime: null, checkOutTime: null, lastName: 'B' },
];

test('a stay without its own times takes its property defaults', () => {
  // Checkout 12:00 + 3 h cleaning ends at 15:00 > check-in 14:00: a turnover the 10:00 / 15:00 fallback hid.
  const out = computePlanningAlerts({
    stays: timeless, cleaningHoursByProperty: { 9: 3 },
    propertyTimes: { 9: { checkIn: '14:00', checkOut: '12:00' } },
    from: '2027-07-01', to: '2027-07-10',
  });
  assert.equal(out.arrivals[2].type, 'red');
  assert.match(out.arrivals[2].explanation, /part le 05\/07\/2027 à 12:00/);
  assert.match(out.departures[1].explanation, /05\/07\/2027 à 14:00/);
});

test('without property defaults the app-wide 15:00 / 10:00 still apply', () => {
  const out = computePlanningAlerts({ stays: timeless, cleaningHoursByProperty: { 9: 3 }, from: '2027-07-01', to: '2027-07-10' });
  assert.equal(out.arrivals[2], undefined, '10:00 + 3 h ends before 15:00');
});

test('the model hands the properties default times to the computation', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, cleaningHours REAL, defaultCheckIn TEXT, defaultCheckOut TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, icalOriginalSummary TEXT);
    INSERT INTO properties VALUES (9, 3, '14:00', '12:00');
    INSERT INTO reservations VALUES (1, 'reservation', 9, NULL, '2027-07-01', '2027-07-05', NULL, NULL, 'A');
    INSERT INTO reservations VALUES (2, 'reservation', 9, NULL, '2027-07-05', '2027-07-08', NULL, NULL, 'B');
  `);
  const model = require('../models/planningAlertsModel').buildModel(db);
  const out = model.alertsInRange({ from: '2027-07-01', to: '2027-07-10' });
  assert.equal(out.arrivals[2].type, 'red');
});
