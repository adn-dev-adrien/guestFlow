// specs/reservations-backend-mvc.md rule 14 (2026-11-02, merge of PR #936 with #937) — a year typed digit by
// digit passes through 0002, 0020, 0203: the fiche's occupancy check reads such a range like any other, and
// never walks it night by night (an arrival at 0002 before a stored departure froze the tab).
import { findFirstOccupiedDateInRange, getRangeOccupancyConflictInfo } from './reservationConflicts';

describe('reservationConflicts — a half-typed year', () => {
  test('rule 14 — a range in year 0002 finds its occupied night', () => {
    expect(findFirstOccupiedDateInRange('0002-10-30', '0002-11-02', ['0002-11-01'])).toBe('0002-11-01');
  });

  test('rule 14 — a range from year 0002 to today\'s century answers at once', () => {
    const start = Date.now();
    expect(findFirstOccupiedDateInRange('0002-10-30', '2031-11-01', [])).toBeNull();
    expect(findFirstOccupiedDateInRange('0002-10-30', '2031-11-01', ['2031-10-31', '2030-01-05'])).toBe('2030-01-05');
    expect(getRangeOccupancyConflictInfo({ startDate: '0002-10-30', endDate: '2031-11-01', occupiedDates: [], reservations: [] })).toBeNull();
    expect(Date.now() - start).toBeLessThan(200);
  });

  test('rule 14 — the end stays exclusive and the start inclusive', () => {
    const occupied = ['2030-01-04', '2030-01-10'];
    expect(findFirstOccupiedDateInRange('2030-01-04', '2030-01-10', occupied)).toBe('2030-01-04');
    expect(findFirstOccupiedDateInRange('2030-01-05', '2030-01-10', occupied)).toBeNull();
  });
});
