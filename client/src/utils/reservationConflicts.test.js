import {
  findFirstOccupiedDateInRange,
  getBlockedNightConflictInfo,
  getDayOccupancyConflictMessage,
  getRangeOccupancyConflictInfo,
} from './reservationConflicts';

describe('reservationConflicts', () => {
  const reservations = [
    {
      id: 1,
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      checkInTime: '09:30',
      checkOutTime: '10:00',
    },
    {
      id: 2,
      startDate: '2026-07-20',
      endDate: '2026-07-22',
      checkInTime: '15:00',
      checkOutTime: '17:30',
    },
    {
      id: 3,
      startDate: '2026-07-28',
      endDate: '2026-07-30',
      checkInTime: '15:00',
      checkOutTime: '10:00',
    },
  ];

  test('finds the first occupied date in a selected range', () => {
    expect(findFirstOccupiedDateInRange('2026-07-08', '2026-07-12', [
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
    ])).toBe('2026-07-09');
  });

  test('detects an early-arrival blocked night', () => {
    expect(getBlockedNightConflictInfo('2026-07-09', reservations)).toEqual({
      type: 'early-arrival',
      reservation: reservations[0],
    });
  });

  test('detects a late-departure blocked evening and following morning', () => {
    expect(getBlockedNightConflictInfo('2026-07-22', reservations)).toEqual({
      type: 'late-departure-evening',
      reservation: reservations[1],
    });
    expect(getBlockedNightConflictInfo('2026-07-23', reservations)).toEqual({
      type: 'late-departure-morning',
      reservation: reservations[1],
    });
  });

  test('returns a specific day message for blocked early arrival', () => {
    expect(getDayOccupancyConflictMessage({
      dateStr: '2026-07-09',
      today: '2026-07-01',
      occupiedDates: ['2026-07-09', '2026-07-10'],
      reservations,
    })).toBe('Ce logement n\'est pas disponible à cette date : la nuit est bloquée par une arrivée anticipée.');
  });

  test('returns a specific range message for late departure blocking', () => {
    const conflict = getRangeOccupancyConflictInfo({
      startDate: '2026-07-22',
      endDate: '2026-07-23',
      occupiedDates: ['2026-07-22'],
      reservations,
    });

    expect(conflict).toMatchObject({
      occupiedDate: '2026-07-22',
      message: 'Ce logement n\'est pas disponible pour ces dates : un départ tardif bloque une nuit supplémentaire.',
      reservation: reservations[1],
    });
    expect(conflict.blockedNightInfo).toEqual({
      type: 'late-departure-evening',
      reservation: reservations[1],
    });
  });

  test('does not flag next night as blocked when late departure no longer overlaps selected range', () => {
    expect(getRangeOccupancyConflictInfo({
      startDate: '2026-07-24',
      endDate: '2026-07-25',
      occupiedDates: ['2026-07-24'],
      reservations,
    })).toBeNull();
  });

  test('excludes the currently edited reservation from range conflicts', () => {
    expect(getRangeOccupancyConflictInfo({
      startDate: '2026-07-28',
      endDate: '2026-07-30',
      occupiedDates: ['2026-07-28', '2026-07-29'],
      reservations,
      excludeReservationId: 3,
    })).toBeNull();
  });

  test('returns the generic reserved message when there is no blocked-night special case', () => {
    const conflict = getRangeOccupancyConflictInfo({
      startDate: '2026-07-28',
      endDate: '2026-07-29',
      occupiedDates: ['2026-07-28'],
      reservations,
    });

    expect(conflict).toMatchObject({
      occupiedDate: '2026-07-28',
      message: 'Ce logement est déjà réservé pour ces dates.',
      reservation: reservations[2],
      blockedNightInfo: null,
    });
  });
});