const test = require('node:test');
const assert = require('node:assert/strict');

const reservationsRoute = require('../routes/reservations');

const { buildOccupiedDatesFromReservations, getNightBlocksFromTimes } = reservationsRoute.__test;

test('getNightBlocksFromTimes detects early check-in and late check-out thresholds', () => {
  assert.deepEqual(getNightBlocksFromTimes('10:00', '10:00'), {
    blocksPreviousNight: 1,
    blocksNextNight: 0,
  });
  assert.deepEqual(getNightBlocksFromTimes('10:30', '17:00'), {
    blocksPreviousNight: 0,
    blocksNextNight: 1,
  });
  assert.deepEqual(getNightBlocksFromTimes('15:00', '10:00'), {
    blocksPreviousNight: 0,
    blocksNextNight: 0,
  });
});

test('buildOccupiedDatesFromReservations includes previous night for early arrival', () => {
  const occupiedDates = buildOccupiedDatesFromReservations([
    {
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      checkInTime: '09:30',
      checkOutTime: '10:00',
    },
  ]);

  assert.deepEqual(occupiedDates, [
    '2026-07-09',
    '2026-07-10',
    '2026-07-11',
  ]);
});

test('buildOccupiedDatesFromReservations includes one blocked date after late departure', () => {
  const occupiedDates = buildOccupiedDatesFromReservations([
    {
      startDate: '2026-08-03',
      endDate: '2026-08-05',
      checkInTime: '15:00',
      checkOutTime: '17:30',
    },
  ]);

  assert.deepEqual(occupiedDates, [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
  ]);
});

test('buildOccupiedDatesFromReservations merges and sorts occupied dates across reservations', () => {
  const occupiedDates = buildOccupiedDatesFromReservations([
    {
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      checkInTime: '09:00',
      checkOutTime: '10:00',
    },
    {
      startDate: '2026-09-15',
      endDate: '2026-09-16',
      checkInTime: '15:00',
      checkOutTime: '18:00',
    },
  ]);

  assert.deepEqual(occupiedDates, [
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-15',
    '2026-09-16',
  ]);
});
