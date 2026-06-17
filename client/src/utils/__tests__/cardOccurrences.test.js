import { describe, test, expect } from 'vitest';
import {
  enumerateStayDates, dailySlots, buildInitialGrid, buildGridFromStored,
  reconcileGrid, toWireOccurrences, selectedCount, isPresent,
} from '../cardOccurrences';

// specs/option-planning-card.md §3.2 + §3.4 — occurrence grid helpers for the fiche checklist.

const dailyOpt = { cardRepeat: 'daily', priceType: 'per_person', planningCardTimes: ['08:00', '12:30'] };
const onceOpt = { cardRepeat: 'once', priceType: 'per_stay', planningCardDate: '2026-07-12', planningCardTimes: ['18:00'] };

describe('enumerateStayDates', () => {
  test('inclusive range', () => {
    expect(enumerateStayDates('2026-07-10', '2026-07-13')).toEqual(['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13']);
  });
  test('invalid / reversed → empty', () => {
    expect(enumerateStayDates('', '2026-07-13')).toEqual([]);
    expect(enumerateStayDates('2026-07-13', '2026-07-10')).toEqual([]);
  });
});

describe('dailySlots', () => {
  test('returns the configured slots', () => {
    expect(dailySlots(dailyOpt)).toEqual(['08:00', '12:30']);
  });
  test('empty config → one untimed slot', () => {
    expect(dailySlots({ planningCardTimes: [] })).toEqual(['']);
  });
});

describe('buildInitialGrid', () => {
  test('daily: every day × slot pre-checked', () => {
    const grid = buildInitialGrid(dailyOpt, '2026-07-10', '2026-07-11');
    expect(grid.length).toBe(4); // 2 days × 2 slots
    expect(grid.every((o) => o.checked)).toBe(true);
    expect(toWireOccurrences(grid)).toEqual([
      { date: '2026-07-10', time: '08:00', done: false }, { date: '2026-07-10', time: '12:30', done: false },
      { date: '2026-07-11', time: '08:00', done: false }, { date: '2026-07-11', time: '12:30', done: false },
    ]);
  });
  test('once: single occurrence at the default date/time', () => {
    const grid = buildInitialGrid(onceOpt, '2026-07-10', '2026-07-13');
    expect(grid).toEqual([{ date: '2026-07-12', time: '18:00', slot: 0, checked: true, done: false }]);
  });
  test('once with no default date → falls back to stay start', () => {
    const grid = buildInitialGrid({ cardRepeat: 'once', planningCardTimes: ['09:00'] }, '2026-07-10', '2026-07-13');
    expect(grid[0].date).toBe('2026-07-10');
  });
});

describe('buildGridFromStored', () => {
  test('daily: only stored occurrences are checked, others unchecked', () => {
    const grid = buildGridFromStored(dailyOpt, '2026-07-10', '2026-07-11', [
      { date: '2026-07-10', time: '08:00' },
      { date: '2026-07-11', time: '12:30' },
    ]);
    expect(selectedCount(grid)).toBe(2);
    const checked = grid.filter((o) => o.checked).map((o) => `${o.date} ${o.time}`);
    expect(checked).toEqual(['2026-07-10 08:00', '2026-07-11 12:30']);
  });
  test('once: the stored occurrence wins', () => {
    const grid = buildGridFromStored(onceOpt, '2026-07-10', '2026-07-13', [{ date: '2026-07-11', time: '19:00' }]);
    expect(grid).toEqual([{ date: '2026-07-11', time: '19:00', slot: 0, checked: true, done: false }]);
  });
  test('the `done` flag round-trips from stored occurrences', () => {
    const grid = buildGridFromStored(dailyOpt, '2026-07-10', '2026-07-10', [
      { date: '2026-07-10', time: '08:00', done: true },
      { date: '2026-07-10', time: '12:30', done: false },
    ]);
    const done0830 = grid.find((o) => o.time === '08:00');
    expect(done0830.done).toBe(true);
    expect(toWireOccurrences(grid).find((o) => o.time === '08:00').done).toBe(true);
  });
});

describe('reconcileGrid on date change', () => {
  test('drops out-of-range days, adds new days pre-checked, preserves existing state', () => {
    const initial = buildInitialGrid(dailyOpt, '2026-07-10', '2026-07-11');
    // uncheck one slot
    const edited = initial.map((o) => (o.date === '2026-07-10' && o.slot === 0 ? { ...o, checked: false } : o));
    // shift the stay to 11 → 12
    const next = reconcileGrid(dailyOpt, '2026-07-11', '2026-07-12', edited);
    const dates = [...new Set(next.map((o) => o.date))];
    expect(dates).toEqual(['2026-07-11', '2026-07-12']);
    // the surviving 07-11 slots keep their (checked) state; 07-12 is brand-new pre-checked
    expect(next.filter((o) => o.date === '2026-07-12').every((o) => o.checked)).toBe(true);
  });
  test('no change → same reference', () => {
    const grid = buildInitialGrid(dailyOpt, '2026-07-10', '2026-07-11');
    expect(reconcileGrid(dailyOpt, '2026-07-10', '2026-07-11', grid)).toBe(grid);
  });
});

describe('presence on the boundary days (check-in / check-out)', () => {
  const ci = '15:00';
  const co = '10:00';
  test('isPresent: arrival day excludes slots before check-in', () => {
    expect(isPresent('2026-07-10', '12:30', '2026-07-10', '2026-07-13', ci, co)).toBe(false);
    expect(isPresent('2026-07-10', '19:30', '2026-07-10', '2026-07-13', ci, co)).toBe(true);
  });
  test('isPresent: departure day excludes slots after check-out', () => {
    expect(isPresent('2026-07-13', '08:00', '2026-07-10', '2026-07-13', ci, co)).toBe(true);
    expect(isPresent('2026-07-13', '12:30', '2026-07-10', '2026-07-13', ci, co)).toBe(false);
  });
  test('isPresent: middle days + untimed slots are always present', () => {
    expect(isPresent('2026-07-11', '08:00', '2026-07-10', '2026-07-13', ci, co)).toBe(true);
    expect(isPresent('2026-07-10', '', '2026-07-10', '2026-07-13', ci, co)).toBe(true);
  });

  test('buildInitialGrid drops boundary slots outside presence (3 meals over 4 days)', () => {
    const meals = { cardRepeat: 'multiple_per_day', priceType: 'per_person', planningCardTimes: ['08:00', '12:30', '19:30'] };
    const grid = buildInitialGrid(meals, '2026-07-10', '2026-07-13', ci, co);
    const byDate = (d) => grid.filter((o) => o.date === d).map((o) => o.time);
    expect(byDate('2026-07-10')).toEqual(['19:30']);               // arrival: only after 15:00
    expect(byDate('2026-07-11')).toEqual(['08:00', '12:30', '19:30']); // full middle day
    expect(byDate('2026-07-12')).toEqual(['08:00', '12:30', '19:30']);
    expect(byDate('2026-07-13')).toEqual(['08:00']);               // departure: only before 10:00
    expect(grid.length).toBe(1 + 3 + 3 + 1);
  });

  test('reconcileGrid re-filters presence when a slot time crosses the check-out bound', () => {
    const meals = { cardRepeat: 'multiple_per_day', priceType: 'per_person', planningCardTimes: ['08:00', '12:30'] };
    const grid = buildInitialGrid(meals, '2026-07-10', '2026-07-11', ci, co); // 11 = departure
    // 08:00 present on the 11th, 12:30 not. Move 08:00 → 16:00 (now after check-out 10:00) on the 11th.
    const retimed = grid.map((o) => (o.slot === 0 ? { ...o, time: '16:00' } : o));
    const next = reconcileGrid(meals, '2026-07-10', '2026-07-11', retimed, ci, co);
    expect(next.some((o) => o.date === '2026-07-11' && o.slot === 0)).toBe(false); // dropped
  });
});

describe('toWireOccurrences', () => {
  test('keeps only checked, strips slot/checked', () => {
    const grid = [
      { date: '2026-07-10', time: '08:00', slot: 0, checked: true },
      { date: '2026-07-10', time: '12:30', slot: 1, checked: false },
    ];
    expect(toWireOccurrences(grid)).toEqual([{ date: '2026-07-10', time: '08:00', done: false }]);
  });
});
