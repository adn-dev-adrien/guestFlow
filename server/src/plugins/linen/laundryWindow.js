/**
 * Laundry window helpers — pure ISO-date arithmetic for the bed-linen laundry trips
 * (specs/weekly-bed-linen-tracking.md, specs/linen-laundry-days.md).
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
 * The latest date strictly before `iso`, at most `maxLookbackDays` back, for which `matches(date)` holds
 * — `null` when none. The walk goes one day at a time, so any set of weekdays is covered: the former
 * 7-day jumps only fitted a single laundry day (specs/linen-laundry-days.md §3.2 rule 8).
 */
function previousMatchingDay(iso, matches, maxLookbackDays = 28) {
  for (let back = 1; back <= maxLookbackDays; back += 1) {
    const candidate = addDays(iso, -back);
    if (matches(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  addDays,
  weekdayOf,
  previousMatchingDay,
  // exported for unit tests
  __test: { parseIso, toIso, assertWeekday },
};
