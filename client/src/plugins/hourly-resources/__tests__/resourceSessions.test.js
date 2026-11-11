import { describe, it, expect } from 'vitest';
import { enumerateStayDates, timeOptions, isHourlyScheduled } from '../resourceSessions';

// specs/resource-hourly-scheduling.md — client helpers for the sessions (no money: specs/resource-supplements-total-server-side.md).

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

describe('isHourlyScheduled', () => {
  it('is true only for a per_hour resource with the planning flag', () => {
    expect(isHourlyScheduled({ showsPlanningCard: 1, priceType: 'per_hour' })).toBe(true);
    expect(isHourlyScheduled({ showsPlanningCard: 0, priceType: 'per_hour' })).toBe(false);
    expect(isHourlyScheduled({ showsPlanningCard: 1, priceType: 'per_stay' })).toBe(false);
  });
});
