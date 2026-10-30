// specs/linen-laundry-days.md §3.4 rules 19-20 and 22 — the draft helpers of the Linge page.
import { afterEach, beforeEach, vi } from 'vitest';
import {
  parseTurnaround, draftFromSchedule, isDraftValid, scheduleBody, sameDraft, effectiveCaption,
} from '../laundryScheduleDraft';

// Pinned to the eve of the fixtures' « tomorrow »: a date of another year says its year (rule 18), so
// on the real clock these captions grew « 2026 » from 2027 on.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T10:00:00')); });
afterEach(() => vi.useRealTimers());

const version = (weekdays, turnaroundDays, effectiveFrom = '0001-01-01') => ({ effectiveFrom, weekdays, turnaroundDays });
const view = (current, pending = null) => ({ current, pending, tomorrow: '2026-10-29' });

test('specs/linen-laundry-days.md §3.4 rule 20: parseTurnaround accepts integers 1..14 only', () => {
  expect(['1', '7', '14', ' 3 '].map(parseTurnaround)).toEqual([1, 7, 14, 3]);
  expect(['0', '15', '2.5', '-1', 'abc', '', '1e1', '+3'].map(parseTurnaround)).toEqual([null, null, null, null, null, null, null, null]);
});

test('specs/linen-laundry-days.md §3.4 rule 20: a draft is valid with one day or more and a turnaround in 1..14', () => {
  expect(isDraftValid({ weekdays: [2], turnaroundText: '1' })).toBe(true);
  expect(isDraftValid({ weekdays: [], turnaroundText: '1' })).toBe(false);
  expect(isDraftValid({ weekdays: [2], turnaroundText: '15' })).toBe(false);
});

test('specs/linen-laundry-days.md §3.4 rule 21: the body sent sorts the days and types the turnaround', () => {
  expect(scheduleBody({ weekdays: [4, 2], turnaroundText: '3' })).toEqual({ weekdays: [2, 4], turnaroundDays: 3 });
  expect(draftFromSchedule(version([4, 2], 3))).toEqual({ weekdays: [2, 4], turnaroundText: '3' });
});

test('specs/linen-laundry-days.md §3.4 rule 21: sameDraft ignores the order of the days and the typed padding', () => {
  expect(sameDraft({ weekdays: [4, 2], turnaroundText: '3' }, { weekdays: [2, 4], turnaroundText: ' 3' })).toBe(true);
  expect(sameDraft({ weekdays: [2], turnaroundText: '3' }, { weekdays: [2, 4], turnaroundText: '3' })).toBe(false);
});

test('specs/linen-laundry-days.md §3.4 rule 19: a draft that differs from the version in force starts tomorrow', () => {
  const caption = effectiveCaption(view(version([2], 1)), { weekdays: [2, 4], turnaroundText: '2' });
  expect(caption).toBe('À partir de demain, jeu. 29 oct.');
});

test('specs/linen-laundry-days.md §3.4 rule 19: no caption when the draft is the version in force, or invalid', () => {
  expect(effectiveCaption(view(version([2], 1)), { weekdays: [2], turnaroundText: '1' })).toBeNull();
  expect(effectiveCaption(view(version([2], 1)), { weekdays: [2, 4], turnaroundText: 'abc' })).toBeNull();
  expect(effectiveCaption(null, { weekdays: [2], turnaroundText: '1' })).toBeNull();
});

test('specs/linen-laundry-days.md §3.4 rule 22: a saved pending version says what stays in force until tomorrow — days and turnaround', () => {
  const v = view(version([2], 1), version([2, 4], 2, '2026-10-29'));
  expect(effectiveCaption(v, { weekdays: [2, 4], turnaroundText: '2' })).toBe('À partir de demain, jeu. 29 oct. · Jusqu’à demain : mardi · 1 jour');
  const several = view(version([1, 3, 5], 3), version([2], 1, '2026-10-29'));
  expect(effectiveCaption(several, { weekdays: [2], turnaroundText: '1' })).toContain('Jusqu’à demain : lundi, mercredi et vendredi · 3 jours');
});

test('specs/linen-laundry-days.md §3.4 rule 22: a turnaround-only pending change is announced too', () => {
  const v = view(version([2], 1), version([2], 3, '2026-10-29'));
  expect(effectiveCaption(v, { weekdays: [2], turnaroundText: '3' })).toBe('À partir de demain, jeu. 29 oct. · Jusqu’à demain : mardi · 1 jour');
});

test('specs/linen-laundry-days.md §3.4 rule 22: with a pending version, going back to the version in force says the change is cancelled, something else shows plain tomorrow', () => {
  const v = view(version([2], 1), version([2, 4], 2, '2026-10-29'));
  expect(effectiveCaption(v, { weekdays: [2], turnaroundText: '1' })).toBe('Changement de demain annulé.');
  expect(effectiveCaption(v, { weekdays: [3], turnaroundText: '1' })).toBe('À partir de demain, jeu. 29 oct.');
});
