/**
 * calendarDaySummary — pure helpers for the mobile week view.
 * See specs/calendar-mobile-view.md.
 */

import { buildDaySummary, isEmptyDay, getMonday, weekDays } from '../calendarDaySummary';

const RES = [
  { id: 1, startDate: '2026-07-10', endDate: '2026-07-13', firstName: 'Jane', lastName: 'S', platform: 'direct' },
];

test('arrival is the reservation starting that day', () => {
  const s = buildDaySummary('2026-07-10', RES, []);
  expect(s.arrival?.id).toBe(1);
  expect(s.departure).toBeNull();
  expect(s.ongoing).toBeNull();
});

test('departure is the reservation ending that day', () => {
  const s = buildDaySummary('2026-07-13', RES, []);
  expect(s.departure?.id).toBe(1);
  expect(s.arrival).toBeNull();
});

test('ongoing is a mid-stay day (strictly between start and end)', () => {
  const s = buildDaySummary('2026-07-11', RES, []);
  expect(s.ongoing?.id).toBe(1);
  expect(isEmptyDay(s)).toBe(false);
});

test('a day with nothing is empty', () => {
  const s = buildDaySummary('2026-07-20', RES, []);
  expect(isEmptyDay(s)).toBe(true);
});

test('devis surface only when no reservation occupies the slot', () => {
  const devis = [{ id: 9, startDate: '2026-07-20', endDate: '2026-07-22', firstName: 'D', lastName: 'Q' }];
  // free day → devis arrival shows
  expect(buildDaySummary('2026-07-20', RES, devis).devis).toEqual([{ kind: 'arrival', devis: devis[0] }]);
  // a day already covered by a reservation arrival → no devis
  const devis2 = [{ id: 9, startDate: '2026-07-10', endDate: '2026-07-22' }];
  expect(buildDaySummary('2026-07-10', RES, devis2).devis).toEqual([]);
});

test('getMonday returns the Monday of the week at local midnight', () => {
  // 2026-07-11 is a Saturday → Monday is 2026-07-06
  const mon = getMonday(new Date(2026, 6, 11));
  expect(mon.getFullYear()).toBe(2026);
  expect(mon.getMonth()).toBe(6);
  expect(mon.getDate()).toBe(6);
});

test('weekDays returns 7 consecutive days from the Monday', () => {
  const days = weekDays(new Date(2026, 6, 6));
  expect(days).toHaveLength(7);
  expect(days[0].getDate()).toBe(6);
  expect(days[6].getDate()).toBe(12);
});
