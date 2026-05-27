const test = require('node:test');
const assert = require('node:assert/strict');

const {
  timeToHour, addIsoDays, getNightBlocksFromTimes, buildOccupiedDatesFromReservations,
} = require('../utils/occupancy');

test('timeToHour parses HH:MM to decimal hours', () => {
  assert.equal(timeToHour('15:30'), 15.5);
  assert.equal(timeToHour('10:00'), 10);
  assert.equal(timeToHour(''), 0);
});

test('addIsoDays shifts ISO dates (UTC-safe)', () => {
  assert.equal(addIsoDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addIsoDays('2026-03-01', -1), '2026-02-28');
});

test('getNightBlocksFromTimes: late checkout blocks next night, early checkin blocks previous night', () => {
  // checkout >= 17h blocks next; checkin <= 10h blocks previous
  assert.deepEqual(getNightBlocksFromTimes('15:00', '10:00'), { blocksPreviousNight: 0, blocksNextNight: 0 });
  assert.deepEqual(getNightBlocksFromTimes('10:00', '10:00'), { blocksPreviousNight: 1, blocksNextNight: 0 });
  assert.deepEqual(getNightBlocksFromTimes('15:00', '17:00'), { blocksPreviousNight: 0, blocksNextNight: 1 });
  assert.deepEqual(getNightBlocksFromTimes('09:00', '18:00'), { blocksPreviousNight: 1, blocksNextNight: 1 });
});

test('buildOccupiedDatesFromReservations expands stays into night-blocked date sets', () => {
  // Standard stay 10→12 (checkin 15h, checkout 10h): nights of the 10 and 11.
  assert.deepEqual(
    buildOccupiedDatesFromReservations([{ startDate: '2026-06-10', endDate: '2026-06-12', checkInTime: '15:00', checkOutTime: '10:00' }]),
    ['2026-06-10', '2026-06-11'],
  );
  // Late checkout (18h) extends one day; early checkin (09h) prepends one day.
  assert.deepEqual(
    buildOccupiedDatesFromReservations([{ startDate: '2026-06-10', endDate: '2026-06-12', checkInTime: '09:00', checkOutTime: '18:00' }]),
    ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'],
  );
});
