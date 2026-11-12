/**
 * STAY CLOCK — has this stay started, is it over? (specs/pricing-components.md §3 rules 20, 44.)
 *
 * Contract: `phaseOf({ arrivalDate, departureDate, checkInTime, checkOutTime }, now)` answers on the
 * Europe/Paris clock:
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
 * The phase is read on instants, so it never steps backwards: a stay's check-in or check-out is the FIRST instant whose
 * Paris wall clock shows that time. On the day clocks go forward a time that never shows (02:30) is reached at 03:00; on
 * the day they go back it is reached at its first occurrence, and the repeated hour that follows does not undo it.
 */

const TIME_ZONE = 'Europe/Paris';
const SAS_WINDOW_END_HOUR = 4;
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

const HOUR_MS = 3600000;
const wallStamp = (instantMs) => {
  const wall = parisWallClock(instantMs);
  return `${wall.day}T${wall.time}`;
};

// The first instant (ms) whose Paris wall clock reads `day T time`; a time skipped by the clocks going forward is reached at
// the first instant that reads later. Paris is UTC+1 or UTC+2, so the instant is one of two candidates, or the gap.
function firstInstantOf(day, time) {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, dayOfMonth, hours, minutes);
  const target = `${day}T${time}`;
  const exact = [wallAsUtc - 2 * HOUR_MS, wallAsUtc - HOUR_MS].filter((candidate) => wallStamp(candidate) === target);
  if (exact.length) return Math.min(...exact);
  let instant = wallAsUtc - 3 * HOUR_MS;
  while (wallStamp(instant) < target) instant += 60000;
  return instant;
}

function phaseOf({ arrivalDate, departureDate, checkInTime, checkOutTime } = {}, now) {
  const arrival = checkDay(arrivalDate, 'arrivalDate');
  const departure = checkDay(departureDate, 'departureDate');
  const checkIn = checkTime(checkInTime, 'checkInTime');
  const checkOut = checkTime(checkOutTime, 'checkOutTime');
  const wall = parisWallClock(now);
  const nowMs = now instanceof Date ? now.getTime() : now;
  let phase = 'during';
  if (nowMs < firstInstantOf(arrival, checkIn)) phase = 'before';
  else if (nowMs >= firstInstantOf(departure, checkOut)) phase = 'after';
  const started = phase !== 'before';
  return {
    phase,
    started,
    defaultCollectAt: started ? 'departure' : 'arrival',
    arrivalDayReached: wall.day >= arrival,
    departureDayReached: wall.day >= departure,
  };
}

// `9:00` and `09:00:00` read as 09:00; anything else that is not a time of day (`abc`, `24:00`, `9h`) is a time nobody
// entered: the caller falls back to the next source (rule 44, the resolver's reading; `timeToDecimalHour` shares it).
function readableTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value == null ? '' : value).trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[3] !== undefined && Number(match[3]) > 59)) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

// The calendar answers about a day that is not a stay's own (a date typed on a form, an endDate): `todayIso` is the Paris
// day the caller injects. Same semantics as the comparisons they replace.
const dayReached = (day, todayIso) => String(todayIso).slice(0, 10) >= String(day).slice(0, 10);
const dayPassed = (day, todayIso) => String(todayIso).slice(0, 10) > String(day).slice(0, 10);

// 'YYYY-MM-DD' → local midnight Date, or null when the value isn't a usable ISO day.
function parseIsoDay(dateIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateIso || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Where `now` stands against the reception window of a SAS dated `dateIso` (specs/reception-sas-today-only.md §3.1): it
 * opens at D 00:00 and closes at D+1 04:00. 'unusable' for a date nobody can read (fail-closed), 'future', 'open', 'past'.
 */
function sasWindowState(dateIso, now) {
  const start = parseIsoDay(dateIso);
  if (!start) return 'unusable';
  if (now < start) return 'future';
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, SAS_WINDOW_END_HOUR);
  return now < end ? 'open' : 'past';
}

// specs/pricing-components.md §3 rule 50 — the settings of this unit, read through SettingsProvider.for('stayClock', scope).
const settingsSchema = [
  { key: 'defaultCheckIn', type: 'string', default: '15:00', scope: 'property', validate: (value) => (TIME_PATTERN.test(String(value)) ? null : 'Heure invalide (HH:MM).') },
  { key: 'defaultCheckOut', type: 'string', default: '10:00', scope: 'property', validate: (value) => (TIME_PATTERN.test(String(value)) ? null : 'Heure invalide (HH:MM).') },
];

module.exports = { phaseOf, TIME_ZONE, SAS_WINDOW_END_HOUR, settingsSchema, readableTime, dayReached, dayPassed, sasWindowState };
