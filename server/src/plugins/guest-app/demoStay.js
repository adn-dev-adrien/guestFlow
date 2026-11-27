/**
 * The fictitious stay of a demo session (specs/guest-app/guest-app-demo-mode.md rules 5, 6). Pure: the lodging, the moment and the
 * instant come in, nothing reads a database or a clock, nothing is stored. The shape is `staysModel.byId`'s, with `id: null` and
 * `demo: true`; the window and the mode are derived by the same helpers a real stay goes through (`currentStay`), so the demo shows
 * what a real stay would show at that moment.
 */

const sdk = require('../sdk');
const {
  addDays, parisDate, resolveLink,
} = require('./currentStay');

const { computeWindow } = sdk.coreModule('stayWindow');

const MOMENTS = Object.freeze(['preArrival', 'stay', 'ended']);
const DEFAULT_MOMENT = 'stay';
const NIGHTS = 3;
const FIRST_NAME = 'Camille';
const LAST_NAME = 'Démo';
const ADULTS = 2;
const DEMO_GATE_CODE = '1234';

const isMoment = (value) => MOMENTS.includes(value);

/** `[startDate, endDate]` of a moment, in Europe/Paris calendar days around today. */
function datesOf(moment, now) {
  const today = parisDate(now);
  if (moment === 'preArrival') return [addDays(today, 5), addDays(today, 5 + NIGHTS)];
  if (moment === 'ended') return [addDays(today, -1 - NIGHTS), addDays(today, -1)];
  return [addDays(today, -1), addDays(today, 2)];
}

/**
 * → the stay row (`id: null`, `demo: true`). `times` is the lodging's own `{ checkInTime, checkOutTime }` (absent: the
 * core's defaults, read by `computeWindow`).
 */
function demoStay({
  propertyId, moment, now, times = {},
}) {
  const [startDate, endDate] = datesOf(isMoment(moment) ? moment : DEFAULT_MOMENT, now);
  return {
    id: null,
    demo: true,
    kind: 'reservation',
    propertyId: Number(propertyId),
    platform: 'direct',
    reservationNumber: null,
    startDate,
    endDate,
    checkInTime: times.checkInTime || null,
    checkOutTime: times.checkOutTime || null,
    adults: ADULTS,
    teens: 0,
    children: 0,
    babies: 0,
    clientFirstName: FIRST_NAME,
    clientLastName: LAST_NAME,
    // No language on file: the phone's own language answers (rule 19 of the app).
    clientLanguage: null,
  };
}

/**
 * What the demo session is at `now`: `{ stay, window, mode, ended }`. The mode is the real helpers' answer for those dates; a stay
 * that is over is the lodging's visitor mode, which carries no stay (rule 3 of the app: a visitor learns nothing of a stay).
 */
function demoSession(args) {
  const stay = demoStay(args);
  const resolved = resolveLink(stay, args.now);
  if (!resolved) return null;
  if (resolved.mode === 'visitor') return { stay: null, window: resolved.window, mode: 'visitor', ended: Boolean(resolved.ended) };
  return { stay, window: computeWindow(stay), mode: resolved.mode, ended: false };
}

module.exports = {
  DEFAULT_MOMENT, DEMO_GATE_CODE, MOMENTS, demoSession, demoStay, isMoment,
};
