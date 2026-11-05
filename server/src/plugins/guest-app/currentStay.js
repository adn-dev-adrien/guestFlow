/**
 * Which stay a lodging or a session is on, at an instant (specs/guest-app.md rules 2, 3, 5, 6, 9). Pure:
 * the rows and the instant come in, nothing reads a database or a clock.
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
const contains = (window, now) => now >= window.start && now < window.end;

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
 * Rules 2-3 — the live stay whose window contains `now`. When windows overlap, the departing stay wins
 * until its check-out time and the arriving one after.
 */
function pickCurrentStay(stays, now) {
  const inWindow = (stays || [])
    .filter(isLiveStay)
    .map((stay) => ({ stay, window: computeWindow(stay) }))
    .filter(({ window }) => window && contains(window, now))
    .sort((a, b) => a.window.checkOut - b.window.checkOut);
  if (!inWindow.length) return null;
  return inWindow.find(({ window }) => now < window.checkOut) || inWindow[inWindow.length - 1];
}

/**
 * Rule 5 — the stay that starts later today, whose window has not opened yet: a guest who scanned too
 * early is told when the gate and the shop open.
 */
function nextOpeningToday(stays, now) {
  const today = parisDate(now);
  const upcoming = (stays || [])
    .filter((stay) => isLiveStay(stay) && String(stay.startDate) === today)
    .map((stay) => ({ stay, window: computeWindow(stay) }))
    .filter(({ window }) => window && now < window.start)
    .sort((a, b) => a.window.start - b.window.start);
  if (!upcoming.length) return null;
  const { window } = upcoming[0];
  return { opensAt: window.start, checkInAt: window.checkIn };
}

/** Scanning a lodging's QR code (rules 2, 3, 5): its current stay, else visitor mode. */
function resolveLodging(stays, now) {
  const current = pickCurrentStay(stays, now);
  if (current) return { mode: 'stay', stay: current.stay, window: current.window };
  return { mode: 'visitor', opening: nextOpeningToday(stays, now) };
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
 * as its stay's window, read from the live reservation. → { mode, window } or null when it is dead. A QR
 * session has no pre-arrival: its proof is standing in the lodging during the window.
 */
function deriveSession(session, stay, now) {
  if (!isLiveStay(stay) || Number(stay.propertyId) !== Number(session.propertyId)) return null;
  if (session.origin === 'lookup') {
    const resolved = resolveLookup(stay, now);
    return resolved && { mode: resolved.mode, window: resolved.window };
  }
  const window = computeWindow(stay);
  return window && contains(window, now) ? { mode: 'stay', window } : null;
}

module.exports = {
  addDays,
  daysBetween,
  deriveSession,
  isLiveStay,
  nextOpeningToday,
  parisDate,
  pickCurrentStay,
  preArrivalOpensAt,
  resolveLodging,
  resolveLookup,
};
