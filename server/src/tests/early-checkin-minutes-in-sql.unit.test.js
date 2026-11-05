// specs/reservations-backend-mvc.md rule 22 (audit R23-3) — a check-in takes the night before at 10:00 or earlier, in
// minutes: 10:30 does not. The SQL of the overlap check and of the closures reads what `getNightBlocksFromTimes` reads;
// the floored hour blocked the night for a check-in from 10:01 to 10:59.
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const reservationsModel = require('../models/reservationsModel');
const closures = require('../models/establishmentClosuresModel');
const { getNightBlocksFromTimes } = require('../utils/occupancy');

const ARRIVAL = inDays(60);
const THREE_BEFORE = inDays(57);

function propertyWithArrival(checkInTime) {
  const propertyId = freshProperty();
  db.prepare('UPDATE properties SET cleaningHours = 2 WHERE id = ?').run(propertyId);
  addStay({ propertyId, start: ARRIVAL, end: inDays(63), checkInTime });
  return propertyId;
}

const leavingOnArrivalDay = (propertyId) => {
  const times = ['15:00', '08:00'];
  return reservationsModel.validateAvailability(propertyId, THREE_BEFORE, ARRIVAL, ...times, null, getNightBlocksFromTimes(...times));
};

for (const checkInTime of ['10:01', '10:30', '10:59', '11:00', '15:00']) {
  test(`rule 22 — a check-in at ${checkInTime} leaves the night before free: the departure that day is accepted`, () => {
    assert.equal(leavingOnArrivalDay(propertyWithArrival(checkInTime)), null);
  });

  test(`rule 22 — a check-in at ${checkInTime} does not touch a closure ending that day`, () => {
    const propertyId = propertyWithArrival(checkInTime);
    assert.equal(closures.findReservationOverlap(propertyId, THREE_BEFORE, ARRIVAL), null);
    assert.deepEqual(closures.findReservationOverlaps(propertyId, THREE_BEFORE, ARRIVAL), []);
  });
}

for (const checkInTime of ['08:00', '09:59', '10:00']) {
  test(`rule 22 — a check-in at ${checkInTime} takes the night before: the departure that day is refused`, () => {
    assert.match(leavingOnArrivalDay(propertyWithArrival(checkInTime)).error, /déjà réservé/);
  });

  test(`rule 22 — a check-in at ${checkInTime} meets a closure ending that day`, () => {
    const propertyId = propertyWithArrival(checkInTime);
    assert.ok(closures.findReservationOverlap(propertyId, THREE_BEFORE, ARRIVAL));
    assert.equal(closures.findReservationOverlaps(propertyId, THREE_BEFORE, ARRIVAL).length, 1);
  });
}

test('rule 22 — either order of the two stays gets the same answer', () => {
  const propertyId = freshProperty();
  db.prepare('UPDATE properties SET cleaningHours = 2 WHERE id = ?').run(propertyId);
  addStay({ propertyId, start: THREE_BEFORE, end: ARRIVAL, checkOutTime: '08:00' });
  const times = ['10:30', '10:00'];
  assert.equal(reservationsModel.validateAvailability(propertyId, ARRIVAL, inDays(63), ...times, null, getNightBlocksFromTimes(...times)), null);
});

test('rule 22 — the departure threshold does not move: 16:59 leaves the night, 17:00 takes it', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: THREE_BEFORE, end: ARRIVAL, checkOutTime: '16:59' });
  assert.equal(closures.findReservationOverlap(propertyId, ARRIVAL, inDays(63)), null);
  db.prepare("UPDATE reservations SET checkOutTime = '17:00' WHERE id = ?").run(stay);
  assert.ok(closures.findReservationOverlap(propertyId, ARRIVAL, inDays(63)));
});
