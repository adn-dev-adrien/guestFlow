/**
 * The laundry schedule as a value (specs/linen-laundry-days.md §3.1): the weekdays the linen goes to
 * the laundry and how many days the laundry keeps it, as dated versions. Pure — no DB.
 *
 * A version is `{ effectiveFrom: 'YYYY-MM-DD', weekdays: number[], turnaroundDays: number }`;
 * weekdays use `Date.getDay()` (0 = Sunday … 6 = Saturday). A date follows the version with the
 * greatest `effectiveFrom <= date`.
 */

const { addDays, weekdayOf } = require('./laundryWindow');

const MIN_TURNAROUND_DAYS = 1;
const MAX_TURNAROUND_DAYS = 14;
const DEFAULT_WEEKDAY = 2;
const BEGINNING_OF_TIME = '0001-01-01';

const ERRORS = Object.freeze({
  weekdaysEmpty: { code: 'LAUNDRY_WEEKDAYS_EMPTY', message: 'Au moins un jour.', field: 'weekdays' },
  weekdayInvalid: { code: 'LAUNDRY_WEEKDAY_INVALID', message: 'Jour invalide.', field: 'weekdays' },
  turnaroundInvalid: { code: 'LAUNDRY_TURNAROUND_INVALID', message: 'Entre 1 et 14 jours.', field: 'turnaroundDays' },
});

const isWeekday = (n) => Number.isInteger(n) && n >= 0 && n <= 6;

/**
 * Rule 3 — validate a candidate schedule. Returns `{ value: { weekdays (sorted), turnaroundDays } }`
 * or `{ error: { code, message, field } }`. Nothing is rounded or coerced: `2.5`, `"abc"` and `0` are
 * refused; a numeric string of an integer is accepted as that integer.
 */
function validateSchedule(input) {
  const body = input && typeof input === 'object' ? input : {};
  const rawDays = body.weekdays;
  if (!Array.isArray(rawDays) || rawDays.length === 0) return { error: ERRORS.weekdaysEmpty };
  const days = rawDays.map((d) => (typeof d === 'number' || (typeof d === 'string' && d.trim() !== '') ? Number(d) : NaN));
  if (!days.every(isWeekday) || new Set(days).size !== days.length) return { error: ERRORS.weekdayInvalid };
  const raw = body.turnaroundDays;
  const turnaround = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
  if (!Number.isInteger(turnaround) || turnaround < MIN_TURNAROUND_DAYS || turnaround > MAX_TURNAROUND_DAYS) {
    return { error: ERRORS.turnaroundInvalid };
  }
  return { value: { weekdays: [...days].sort((a, b) => a - b), turnaroundDays: turnaround } };
}

const sameSchedule = (a, b) => Boolean(a && b)
  && a.turnaroundDays === b.turnaroundDays
  && a.weekdays.length === b.weekdays.length
  && a.weekdays.every((d, i) => d === b.weekdays[i]);

/**
 * Rule 7 — per laundry weekday, where the batch dropped that day comes back: the first laundry day
 * on or after `drop + turnaroundDays`. `waitDays` counts from the drop; with one weekday it is the
 * turnaround rounded up to whole weeks.
 */
function describeCycle({ weekdays, turnaroundDays }) {
  const set = new Set(weekdays);
  const cycle = [...weekdays].sort((a, b) => a - b).map((dropWeekday) => {
    let waitDays = turnaroundDays;
    while (!set.has((dropWeekday + waitDays) % 7)) waitDays += 1;
    return { dropWeekday, pickUpWeekday: (dropWeekday + waitDays) % 7, waitDays };
  });
  return { cycle, longestWaitDays: Math.max(...cycle.map((c) => c.waitDays)) };
}

/** The first laundry day on or after `fromIso` for a weekday set. */
function firstLaundryDayFrom(fromIso, weekdays) {
  const set = new Set(weekdays);
  let cursor = fromIso;
  while (!set.has(weekdayOf(cursor))) cursor = addDays(cursor, 1);
  return cursor;
}

/**
 * @param {Array<{effectiveFrom:string, weekdays:number[], turnaroundDays:number}>} versions at least one
 */
function createSchedule(versions) {
  const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const dayCache = new Map();
  const versionOn = (date) => {
    let found = sorted[0];
    for (const v of sorted) {
      if (v.effectiveFrom <= date) found = v;
      else break;
    }
    return found;
  };
  const isRegularDay = (date) => {
    const v = versionOn(date);
    let set = dayCache.get(v);
    if (!set) { set = new Set(v.weekdays); dayCache.set(v, set); }
    return set.has(weekdayOf(date));
  };
  const readyFrom = (dropDate) => addDays(dropDate, versionOn(dropDate).turnaroundDays);
  const regularDaysInRange = (from, to) => {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (isRegularDay(d)) out.push(d);
    return out;
  };
  return { versions: sorted, versionOn, isRegularDay, readyFrom, regularDaysInRange };
}

module.exports = {
  createSchedule,
  validateSchedule,
  describeCycle,
  firstLaundryDayFrom,
  sameSchedule,
  DEFAULT_WEEKDAY,
  BEGINNING_OF_TIME,
  MIN_TURNAROUND_DAYS,
  MAX_TURNAROUND_DAYS,
};
