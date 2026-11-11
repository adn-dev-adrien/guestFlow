/**
 * STAY CLOCK — has this stay started, is it over? (specs/pricing-components.md §3 rules 20, 44.)
 *
 * Contract: `phaseOf({ arrivalDate, departureDate, checkInTime, checkOutTime }, now)` answers on the
 * Europe/Paris wall clock:
 *   phase               'before' until `arrivalDate T checkInTime`, 'during' until `departureDate T checkOutTime`,
 *                       'after' from then on (the minute itself belongs to the later phase)
 *   started             phase !== 'before'
 *   defaultCollectAt    started ? 'departure' : 'arrival'
 *   arrivalDayReached   the Paris calendar day is >= arrivalDate (the question is about the day, not the hour)
 *   departureDayReached the Paris calendar day is >= departureDate
 *
 * Pure: no DB, no settings, no `Date.now()`. `now` is a Date or a number of milliseconds, injected by the caller.
 * Times arrive complete (`HH:MM`); filling a missing one from the property is the resolver's job
 * (models/stayClockModel.js). A malformed date, time or `now` throws a STAY_CLOCK_INVALID error.
 *
 * Wall-clock reading, on purpose: on the day clocks go forward a check-in at 02:30 (which never shows) is reached
 * at 03:00; on the day they go back it is reached at its first 02:30. No offset arithmetic is involved.
 */

const TIME_ZONE = 'Europe/Paris';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parisParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function invalid(what, value) {
  const error = new Error(`STAY_CLOCK_INVALID: ${what} ${JSON.stringify(value)}`);
  error.code = 'STAY_CLOCK_INVALID';
  return error;
}

function checkDay(value, what) {
  const match = DAY_PATTERN.exec(String(value));
  if (!match) throw invalid(what, value);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) throw invalid(what, value);
  return String(value);
}

function checkTime(value, what) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) throw invalid(what, value);
  return value;
}

/** `{ day: 'YYYY-MM-DD', time: 'HH:MM' }` of `now` on the Paris wall clock. */
function parisWallClock(now) {
  const instant = now instanceof Date ? now : (typeof now === 'number' ? new Date(now) : null);
  if (!instant || Number.isNaN(instant.getTime())) throw invalid('now', now);
  const parts = Object.fromEntries(parisParts.formatToParts(instant).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function phaseOf({ arrivalDate, departureDate, checkInTime, checkOutTime } = {}, now) {
  const arrival = checkDay(arrivalDate, 'arrivalDate');
  const departure = checkDay(departureDate, 'departureDate');
  const checkIn = checkTime(checkInTime, 'checkInTime');
  const checkOut = checkTime(checkOutTime, 'checkOutTime');
  const wall = parisWallClock(now);
  const stamp = `${wall.day}T${wall.time}`;
  let phase = 'during';
  if (stamp < `${arrival}T${checkIn}`) phase = 'before';
  else if (stamp >= `${departure}T${checkOut}`) phase = 'after';
  const started = phase !== 'before';
  return {
    phase,
    started,
    defaultCollectAt: started ? 'departure' : 'arrival',
    arrivalDayReached: wall.day >= arrival,
    departureDayReached: wall.day >= departure,
  };
}

// specs/pricing-components.md §3 rule 50 — the settings of this unit, read through SettingsProvider.for('stayClock', scope).
const settingsSchema = [
  { key: 'defaultCheckIn', type: 'string', default: '15:00', scope: 'property', validate: (value) => (TIME_PATTERN.test(String(value)) ? null : 'Heure invalide (HH:MM).') },
  { key: 'defaultCheckOut', type: 'string', default: '10:00', scope: 'property', validate: (value) => (TIME_PATTERN.test(String(value)) ? null : 'Heure invalide (HH:MM).') },
];

module.exports = { phaseOf, TIME_ZONE, settingsSchema };
