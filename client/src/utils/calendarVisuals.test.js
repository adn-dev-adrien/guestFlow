import {
  getDaysInMonth,
  formatDate,
  shiftDate,
  timeToHour,
  hourToPercent,
  compactName,
  resHasMidDays,
  getBlockedNightInfo,
  DAY_START,
  DAY_END,
} from './calendarVisuals';

describe('calendarVisuals', () => {
  describe('formatDate / shiftDate / getDaysInMonth', () => {
    it('zero-pads month and day', () => {
      expect(formatDate(2026, 0, 5)).toBe('2026-01-05');
      expect(formatDate(2026, 11, 25)).toBe('2026-12-25');
    });
    it('shifts across month and year boundaries', () => {
      expect(shiftDate('2026-07-10', 1)).toBe('2026-07-11');
      expect(shiftDate('2026-07-31', 1)).toBe('2026-08-01');
      expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
      expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    });
    it('returns empty on bad input', () => {
      expect(shiftDate('', 1)).toBe('');
      expect(shiftDate('not-a-date', 1)).toBe('');
    });
    it('counts days in a month (incl. leap February)', () => {
      expect(getDaysInMonth(2026, 1)).toBe(28);
      expect(getDaysInMonth(2024, 1)).toBe(29);
      expect(getDaysInMonth(2026, 3)).toBe(30);
    });
  });

  describe('timeToHour / hourToPercent', () => {
    it('parses HH:MM to decimal hours', () => {
      expect(timeToHour('10:00')).toBe(10);
      expect(timeToHour('15:30')).toBe(15.5);
      expect(timeToHour('')).toBe(0);
    });
    it('maps the 8h–21h window to 0–100% and clamps', () => {
      expect(hourToPercent(DAY_START)).toBe(0);
      expect(hourToPercent(DAY_END)).toBe(100);
      expect(hourToPercent(6)).toBe(0); // clamp low
      expect(hourToPercent(23)).toBe(100); // clamp high
      expect(Math.round(hourToPercent(14.5))).toBe(50);
    });
  });

  describe('compactName', () => {
    it('uses first-initial + last name', () => {
      expect(compactName('Jean', 'Dup')).toBe('J. Dup');
    });
    it('truncates names longer than 8 chars', () => {
      expect(compactName('Jean', 'Dupont')).toBe('J. Dupo…');
    });
    it('handles missing first name', () => {
      expect(compactName('', 'Li')).toBe('Li');
    });
  });

  describe('resHasMidDays', () => {
    const inJuly = (res) => resHasMidDays(res, 2026, 6, 31);
    it('false for a 1-night stay (no mid days)', () => {
      expect(inJuly({ startDate: '2026-07-10', endDate: '2026-07-11' })).toBe(false);
    });
    it('true when a mid day falls inside the month', () => {
      expect(inJuly({ startDate: '2026-07-10', endDate: '2026-07-15' })).toBe(true);
    });
    it('false when the only mid days are in another month', () => {
      expect(inJuly({ startDate: '2026-08-10', endDate: '2026-08-15' })).toBe(false);
    });
  });

  describe('getBlockedNightInfo', () => {
    it('returns null when there is no blocked night', () => {
      expect(getBlockedNightInfo('2026-07-15', [])).toBeNull();
    });
    it('maps an early arrival to a top-of-day percentage band', () => {
      // arrival at 09:00 (<= 10h) blocks the previous evening
      const reservations = [{ id: 1, startDate: '2026-07-11', endDate: '2026-07-13', checkInTime: '09:00', checkOutTime: '10:00' }];
      const info = getBlockedNightInfo('2026-07-10', reservations);
      expect(info?.type).toBe('early-arrival');
      expect(info.endPct).toBe(100);
      expect(info.client.id).toBe(1);
    });
  });
});
