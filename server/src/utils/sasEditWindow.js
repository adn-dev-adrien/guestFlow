/**
 * SAS edit window for the « Accueil » role (specs/reception-sas-today-only.md §3.1).
 *
 * A reception user only handles the work of the DAY: the arrival SAS of a reservation starting today,
 * the departure SAS of one ending today. The window opens at `D` 00:00 and closes at `D+1` 04:00 —
 * the 4-hour tail covers a check-in validated after midnight and a check-out started before dawn,
 * without ever opening the following day's arrivals.
 *
 * Pure functions on the server clock (`now` is always injected, never read here) — the client never
 * does this arithmetic, it only renders the resolved reason (fat backend, thin frontend).
 */

// Retune the tolerance here and nowhere else.
const SAS_WINDOW_END_HOUR = 4;

// 'YYYY-MM-DD' → local midnight Date, or null when the value isn't a usable ISO day.
function parseIsoDay(dateIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateIso || ''));
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Is `now` inside the edit window of a SAS dated `dateIso`?
 * @param {string} dateIso - the SAS date ('YYYY-MM-DD'): startDate for an arrival, endDate for a departure.
 * @param {Date} now - the reference instant (server clock).
 * @returns {boolean} false when the date is missing/unparsable (fail-closed).
 */
function isWithinSasWindow(dateIso, now) {
  const start = parseIsoDay(dateIso);
  if (!start) return false;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, SAS_WINDOW_END_HOUR);
  return now >= start && now < end;
}

/**
 * Why a reception user cannot edit this SAS — `null` when they can.
 * `done` wins over the date reasons: a SAS committed today reads « déjà effectué », not « à venir ».
 * @param {{dateIso: string, doneAt: ?string, now: Date}} params
 * @returns {null|'done'|'future'|'past'}
 */
function sasLockReason({ dateIso, doneAt, now }) {
  if (doneAt) return 'done';
  const start = parseIsoDay(dateIso);
  if (!start) return 'past'; // unusable date → treat as closed, never as editable.
  if (now < start) return 'future';
  return isWithinSasWindow(dateIso, now) ? null : 'past';
}

module.exports = { SAS_WINDOW_END_HOUR, isWithinSasWindow, sasLockReason };
