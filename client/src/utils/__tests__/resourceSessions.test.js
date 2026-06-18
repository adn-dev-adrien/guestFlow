import { describe, it, expect } from 'vitest';
import { enumerateStayDates, timeOptions, previewRangeTotal, previewSessionsTotal, isHourlyScheduled } from '../resourceSessions';

// specs/resource-hourly-scheduling.md — the client preview pricer mirrors the server grid.
const GUEST = { dayRate: 30, eveningRate: 50, eveningStart: '20:00', slotMinutes: 30 };

describe('enumerateStayDates', () => {
  it('lists inclusive days without TZ shift', () => {
    expect(enumerateStayDates('2026-07-10', '2026-07-12')).toEqual(['2026-07-10', '2026-07-11', '2026-07-12']);
  });
});

describe('timeOptions', () => {
  it('steps by slot within the window', () => {
    expect(timeOptions('12:00', '13:00', 30)).toEqual(['12:00', '12:30', '13:00']);
  });
});

describe('previewRangeTotal', () => {
  it('bills each 30-min slice at its band', () => {
    expect(previewRangeTotal('19:00', '21:00', GUEST)).toBe(80); // 2×15 + 2×25
    expect(previewRangeTotal('14:00', '16:00', GUEST)).toBe(60); // day only
  });
  it('applies the free first hour', () => {
    expect(previewRangeTotal('19:00', '21:00', GUEST, 60)).toBe(50); // 80 − 30
  });
});

describe('previewSessionsTotal', () => {
  it('sums sessions, free hour once on the earliest', () => {
    const sessions = [
      { date: '2026-07-11', start: '20:00', end: '22:00' }, // 100
      { date: '2026-07-10', start: '19:00', end: '21:00' }, // 80, earliest → 30 free
    ];
    expect(previewSessionsTotal(sessions, GUEST, 60)).toBe(150);
  });
});

describe('isHourlyScheduled', () => {
  it('is true only for a per_hour resource with the planning flag', () => {
    expect(isHourlyScheduled({ showsPlanningCard: 1, priceType: 'per_hour' })).toBe(true);
    expect(isHourlyScheduled({ showsPlanningCard: 0, priceType: 'per_hour' })).toBe(false);
    expect(isHourlyScheduled({ showsPlanningCard: 1, priceType: 'per_stay' })).toBe(false);
  });
});
