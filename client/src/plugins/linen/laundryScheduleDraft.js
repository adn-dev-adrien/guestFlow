/**
 * The draft of the laundry schedule on the Linge page (specs/linen-laundry-days.md §3.4 rules 20-22).
 *
 * The draft keeps the turnaround as typed so a half-typed value can be shown as refused. The checks
 * mirror the server's (rule 3) for comfort only: the server's answer is the one that counts, and its
 * message replaces these.
 */
import { formatDayShort } from './formatLinen';
import { weekdaysSentence } from './weekdays';

export const WEEKDAYS_ERROR = 'Au moins un jour.';
export const TURNAROUND_ERROR = 'Entre 1 et 14 jours.';
export const MIN_TURNAROUND = 1;
export const MAX_TURNAROUND = 14;

/** The typed turnaround as an integer in 1..14, or null. */
export function parseTurnaround(text) {
  if (!/^\s*\d+\s*$/.test(String(text))) return null;
  const n = Number(text);
  return n >= MIN_TURNAROUND && n <= MAX_TURNAROUND ? n : null;
}

/** `{ weekdays, turnaroundDays }` of the API → a draft. */
export function draftFromSchedule(schedule) {
  return {
    weekdays: [...schedule.weekdays].sort((a, b) => a - b),
    turnaroundText: String(schedule.turnaroundDays),
  };
}

export function isDraftValid(draft) {
  return draft.weekdays.length > 0 && parseTurnaround(draft.turnaroundText) !== null;
}

/** The body of `PUT /api/laundry/schedule` / `POST …/preview`. */
export function scheduleBody(draft) {
  return { weekdays: [...draft.weekdays].sort((a, b) => a - b), turnaroundDays: parseTurnaround(draft.turnaroundText) };
}

export function sameDraft(a, b) {
  const x = scheduleBody(a);
  const y = scheduleBody(b);
  return x.turnaroundDays === y.turnaroundDays && x.weekdays.join() === y.weekdays.join();
}

/**
 * The line under the fields (rules 19 and 22), or null. `view` is `GET /api/laundry/schedule`.
 * A draft that differs from the version in force starts tomorrow; a saved pending version says what
 * is still in force today.
 */
export function effectiveCaption(view, draft) {
  if (!view || !isDraftValid(draft)) return null;
  const tomorrow = `À partir de demain, ${formatDayShort(view.tomorrow)}`;
  const current = draftFromSchedule(view.current);
  if (view.pending && sameDraft(draft, draftFromSchedule(view.pending))) {
    return `${tomorrow} — aujourd’hui : ${weekdaysSentence(current.weekdays)}`;
  }
  return sameDraft(draft, current) ? null : tomorrow;
}
