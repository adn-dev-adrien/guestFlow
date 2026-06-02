/**
 * Laundry window helpers — pure ISO-date arithmetic for the weekly bed-linen feature
 * (specs/weekly-bed-linen-tracking.md).
 *
 * All inputs / outputs are `YYYY-MM-DD` strings. Weekdays use `Date.prototype.getDay()`'s
 * convention: 0=Sun, 1=Mon, 2=Tue, … 6=Sat.
 *
 * DST safety: every operation parses the date as UTC midnight (`T00:00:00Z`) and reads back
 * via `toISOString().slice(0, 10)`. That way day arithmetic stays at +24h regardless of the
 * server's local timezone — the CET→CEST transition on the last Sunday of March used to
 * give a 23h day if we operated on local-midnight Date instances.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(iso) {
  if (!ISO_DATE_RE.test(String(iso || ''))) {
    throw new Error(`INVALID_ISO_DATE:${iso}`);
  }
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return toIso(d);
}

function weekdayOf(iso) {
  return parseIso(iso).getUTCDay();
}

function assertWeekday(weekday) {
  const n = Number(weekday);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error(`INVALID_WEEKDAY:${weekday}`);
  }
  return n;
}

/**
 * Enumerate every occurrence of `weekday` (0..6) between `fromIso` and `toIso`, inclusive on
 * both bounds. Returns an array of ISO date strings in chronological order. Empty array if no
 * occurrence fits in the range, or if `from > to`.
 */
function findLaundryDaysInRange(fromIso, toIso, weekday) {
  const wd = assertWeekday(weekday);
  if (fromIso > toIso) return [];
  // Walk forward from `from` until we hit the first matching weekday, then step by 7.
  let cursor = fromIso;
  const cursorWd = weekdayOf(cursor);
  const delta = (wd - cursorWd + 7) % 7;
  cursor = addDays(cursor, delta);
  const out = [];
  while (cursor <= toIso) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

/**
 * The laundry day exactly 7 days before `iso`. Used to compute `Pick-up(L) = Drop-off(L - 7)`.
 */
function prevLaundryDay(iso) {
  return addDays(iso, -7);
}

module.exports = {
  addDays,
  weekdayOf,
  findLaundryDaysInRange,
  prevLaundryDay,
  // exported for unit tests
  __test: { parseIso, toIso, assertWeekday },
};
