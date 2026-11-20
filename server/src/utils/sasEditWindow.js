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

const { SAS_WINDOW_END_HOUR, sasWindowState } = require('./pricing/stayClock');

/**
 * Is `now` inside the edit window of a SAS dated `dateIso`?
 * @param {string} dateIso - the SAS date ('YYYY-MM-DD'): startDate for an arrival, endDate for a departure.
 * @param {Date} now - the reference instant (server clock).
 * @returns {boolean} false when the date is missing/unparsable (fail-closed).
 */
function isWithinSasWindow(dateIso, now) {
  return sasWindowState(dateIso, now) === 'open';
}

/**
 * Why a reception user cannot edit this SAS — `null` when they can. The window itself is the stay clock's
 * (`sasWindowState`, rule 45); `stay` is the reservation row and `side` the SAS it is about.
 * `done` wins over the date reasons: a SAS committed today reads « déjà effectué », not « à venir ».
 * @param {{stay: {startDate: string, endDate: string}, side: 'arrival'|'departure', doneAt: ?string, now: Date}} params
 * @returns {null|'done'|'future'|'past'}
 */
function sasLockReason({ stay, side, doneAt, now }) {
  if (doneAt) return 'done';
  const state = sasWindowState(side === 'arrival' ? stay.startDate : stay.endDate, now);
  if (state === 'unusable') return 'past'; // unusable date → treat as closed, never as editable.
  return state === 'open' ? null : state;
}

module.exports = { SAS_WINDOW_END_HOUR, isWithinSasWindow, sasLockReason };
