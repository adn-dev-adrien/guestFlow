// specs/linen-laundry-days.md rule 18 and §6.3 — a date of another year says its year.
import { afterEach, beforeEach, vi } from 'vitest';
import { formatDayShort, formatDayRange } from '../formatLinen';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T10:00:00')); });
afterEach(() => vi.useRealTimers());

test('specs/linen-laundry-days.md rule 18: a date of the current year has no year, a date of another year has it', () => {
  expect(formatDayShort('2026-11-23')).toBe('lun. 23 nov.');
  expect(formatDayShort('2027-07-25')).toBe('dim. 25 juil. 2027');
});

test('specs/linen-laundry-days.md rule 18: a spell within the current year shows none', () => {
  expect(formatDayRange('2026-11-13', '2026-11-23')).toBe('du ven. 13 au lun. 23 nov.');
});

test('specs/linen-laundry-days.md rule 18: a spell in the next year, or across new year, says the years', () => {
  expect(formatDayRange('2027-07-21', '2027-07-25')).toBe('du mer. 21 au dim. 25 juil. 2027');
  expect(formatDayRange('2026-12-30', '2027-01-02')).toBe('du mer. 30 déc. au sam. 2 janv. 2027');
  expect(formatDayRange('2027-07-25', '2027-07-25')).toBe('le dim. 25 juil. 2027');
});
