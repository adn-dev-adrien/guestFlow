/**
 * What a stay link, the fallback lookup or a session opens, at an instant (specs/guest-app.md rules 2, 4-6,
 * 9). Pure: the rows and the instant come in, nothing reads a database or a clock.
 *
 * A stay row carries `kind`, `propertyId`, `startDate`, `endDate`, `checkInTime`, `checkOutTime`. Cancelling
 * a reservation moves its `kind` away from `reservation`, so that test also excludes a superseded stay and a
 * devis.
 */

const sdk = require('../sdk');

const { computeWindow, toParisIso, wallClockToDate } = sdk.coreModule('stayWindow');

const PRE_ARRIVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const isLiveStay = (stay) => Boolean(stay) && stay.kind === 'reservation';

/** The Europe/Paris calendar date of an instant: `2026-10-06`. */
function parisDate(instant) {
  const iso = toParisIso(instant);
  return iso ? iso.slice(0, 10) : '';
}

/** `a` − `b` in calendar days, two `YYYY-MM-DD`. */
function daysBetween(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

function addDays(ymd, days) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Rule 6 — the fallback opens at 00:00 Europe/Paris, seven days before the arrival date. */
function preArrivalOpensAt(stay) {
  return wallClockToDate(addDays(String(stay.startDate), -PRE_ARRIVAL_DAYS), '00:00');
}

/**
 * Rule 5 — on the arrival day, before the window opens: when the gate and the shop open. Null on any other
 * day or once the window is open.
 */
function openingToday(stay, window, now) {
  if (String(stay.startDate) !== parisDate(now) || now >= window.start) return null;
  return { opensAt: window.start, checkInAt: window.checkIn };
}

/**
 * Opening the stay link (rule 2): pre-arrival from J-7 00:00 until the window opens, the stay inside the
 * window, the lodging's visitor mode before J-7 and after the window (`ended`). Null for a row that is no
 * live stay: the caller answers like an unknown code.
 */
function resolveLink(stay, now) {
  if (!isLiveStay(stay)) return null;
  const window = computeWindow(stay);
  if (!window) return null;
  if (now >= window.end) return { mode: 'visitor', ended: true, window };
  if (now >= window.start) return { mode: 'stay', stay, window };
  if (now >= preArrivalOpensAt(stay)) return { mode: 'preArrival', stay, window };
  return { mode: 'visitor', window };
}

/**
 * The fallback (rule 6): accepted from J-7 00:00 until the window's end, `preArrival` before the window.
 * Null outside those bounds, the caller answers with the one generic error.
 */
function resolveLookup(stay, now) {
  if (!isLiveStay(stay)) return null;
  const window = computeWindow(stay);
  if (!window || now >= window.end) return null;
  if (now >= window.start) return { mode: 'stay', stay, window };
  if (now >= preArrivalOpensAt(stay)) return { mode: 'preArrival', stay, window };
  return null;
}

/**
 * Re-derived on every request (rule 9 and the « dates changed » edge case): the session lives only as long
 * as its stay's window, read from the live reservation. → { mode, window, expiresAt } or null when it is
 * dead. A lookup session moves from pre-arrival to the stay by itself; a link session keeps the phase it was
 * opened in (rule 4): a pre-arrival one ends when the window opens, and the app exchanges the link again.
 */
function deriveSession(session, stay, now) {
  if (!isLiveStay(stay) || Number(stay.propertyId) !== Number(session.propertyId)) return null;
  if (session.origin === 'lookup') {
    const resolved = resolveLookup(stay, now);
    return resolved && { mode: resolved.mode, window: resolved.window, expiresAt: resolved.window.end };
  }
  const resolved = resolveLink(stay, now);
  if (!resolved || resolved.mode !== session.mode) return null;
  if (resolved.mode === 'preArrival') return { mode: 'preArrival', window: resolved.window, expiresAt: resolved.window.start };
  if (resolved.mode === 'stay') return { mode: 'stay', window: resolved.window, expiresAt: resolved.window.end };
  return null;
}

module.exports = {
  addDays,
  daysBetween,
  deriveSession,
  isLiveStay,
  openingToday,
  parisDate,
  preArrivalOpensAt,
  resolveLink,
  resolveLookup,
};
