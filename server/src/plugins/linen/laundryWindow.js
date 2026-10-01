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

/**
 * Like `prevLaundryDay` but walks back through any laundry days the operator marked as
 * skipped (`skippedDates`, a `Set<string>` of ISO dates). Precondition: `iso` MUST itself be
 * a laundry day — we step in 7-day jumps so the weekday is preserved by construction.
 *
 * specs/skip-laundry-trip.md §3.1 rule 6 — a skipped trip defers BOTH drop-off and pick-up
 * to the next non-skipped trip. Concretely, the half-open drop-off window on the next
 * non-skipped trip `L` is `(prevNonSkipped, L]` instead of `(L-7, L]`, so reservations from
 * the in-between weeks finally show up in "À apporter".
 *
 * Walks back at most `maxLookbackDays` (default 28, i.e. 4 weeks). Returns `null` when no
 * non-skipped trip exists within the lookback — the caller should fall back to a plain
 * `addDays(iso, -7)` so we keep producing windows under that degenerate "haven't done
 * laundry in a month" state.
 */
function previousNonSkippedLaundryDay(iso, skippedDates, maxLookbackDays = 28) {
  let candidate = addDays(iso, -7);
  if (!skippedDates || skippedDates.size === 0) return candidate;
  const maxSteps = Math.floor(maxLookbackDays / 7);
  for (let i = 0; i < maxSteps; i += 1) {
    if (!skippedDates.has(candidate)) return candidate;
    candidate = addDays(candidate, -7);
  }
  return null;
}

/**
 * The most recent regular laundry day on-or-before `iso` (ignores skips). Returns the ISO date.
 */
function previousOrSameLaundryDay(iso, weekday) {
  const wd = assertWeekday(weekday);
  const delta = (weekdayOf(iso) - wd + 7) % 7;
  return addDays(iso, -delta);
}

/**
 * The last NON-SKIPPED regular laundry day strictly before `iso` — `iso` may be any date (a
 * regular day, an extra-trip date, or a plain day). Starts at the regular day on/before `iso − 1`,
 * then walks back in 7-day steps over skipped dates, with the same 4-candidate lookback + `null`
 * semantics as `previousNonSkippedLaundryDay` — so for a regular `iso` the two helpers agree.
 *
 * specs/laundry-extra-trip.md §3.2 rule 7 — the trip sequence anchors on this regular trip (a
 * regular trip always takes the whole pool back), then the extra trips in between are replayed.
 */
function previousNonSkippedRegularBefore(iso, weekday, skippedDates, maxLookbackDays = 28) {
  let candidate = previousOrSameLaundryDay(addDays(iso, -1), weekday);
  if (!skippedDates || skippedDates.size === 0) return candidate;
  const maxSteps = Math.floor(maxLookbackDays / 7);
  for (let i = 0; i < maxSteps; i += 1) {
    if (!skippedDates.has(candidate)) return candidate;
    candidate = addDays(candidate, -7);
  }
  return null;
}

/**
 * Extra-trip dates that are ACTIVE for the given laundry weekday: a stored extra trip whose weekday
 * is the regular laundry day is inert (specs/laundry-extra-trip.md §3.1 rule 2 — that day is already
 * a trip; the regular rules apply). Returns a sorted array of ISO dates.
 */
function activeExtraDates(extraDates, weekday) {
  const wd = assertWeekday(weekday);
  return Array.from(extraDates || [])
    .filter((d) => weekdayOf(d) !== wd)
    .sort();
}

module.exports = {
  addDays,
  weekdayOf,
  findLaundryDaysInRange,
  prevLaundryDay,
  previousNonSkippedLaundryDay,
  previousOrSameLaundryDay,
  previousNonSkippedRegularBefore,
  activeExtraDates,
  // exported for unit tests
  __test: { parseIso, toIso, assertWeekday },
};
