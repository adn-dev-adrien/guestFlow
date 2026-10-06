/**
 * The validity window of a guest gate key (specs/gate-access-sowel-connector.md §3.1 rule 4).
 *
 *   start = startDate + checkInTime  − 3 h   (the check-in time is the planned arrival; a guest
 *                                              early by a few hours is let in — contract v2, 2026-09-27)
 *   end   = endDate   + checkOutTime + 2 h
 *
 * The two margins are real durations applied to the resolved instants, so a DST night never
 * stretches or shrinks them.
 *
 * Both ends are **Europe/Paris wall clock**, because that is what is written on the contract and
 * what the guest reads. It is computed from the live reservation at every read of the list of keys
 * (specs/gate-access-sowel-connector.md §3.1 rule 3): moving the dates moves the key with them, with no
 * operator action.
 *
 * Why the conversion is not `new Date('2026-09-12T16:00')`: that parses in the *server's* zone.
 * The VM is on Europe/Paris today, but the app also runs in CI and on a laptop, and a booking
 * straddling the last Sunday of March must still open at 16:00 local. So the wall clock is
 * resolved against the zone explicitly, through the offset the zone actually had at that instant.
 */

const TIME_ZONE = 'Europe/Paris';
const ONE_HOUR_MS = 60 * 60 * 1000;
/** Margins around the stay (specs/gate-access-sowel-connector.md §3.1 rule 4). */
const OPENS_BEFORE_CHECK_IN_MS = 3 * ONE_HOUR_MS;
const CLOSES_AFTER_CHECK_OUT_MS = 2 * ONE_HOUR_MS;

// Reservations carry their own check-in/check-out times (schema defaults '15:00' / '10:00'), but a
// legacy row can hold an empty string; these are the same defaults the schema uses.
const DEFAULT_CHECK_IN = '15:00';
const DEFAULT_CHECK_OUT = '10:00';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * The zone's UTC offset, in ms, at a given instant. Read from Intl rather than a table, so DST
 * rule changes arrive with the platform's tz database instead of a code release.
 */
function zoneOffsetMs(instantMs) {
  const parts = {};
  for (const { type, value } of PARTS.formatToParts(new Date(instantMs))) {
    if (type !== 'literal') parts[type] = value;
  }
  // `hour` comes back as '24' at midnight with hour12:false on some ICU versions.
  const hour = Number(parts.hour) % 24;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - instantMs;
}

/**
 * `2026-09-12` + `16:00` (Europe/Paris) → the matching `Date`.
 *
 * Two passes: the first guesses with the offset at the naive instant, the second corrects it when
 * that guess landed on the other side of a DST boundary. Both irregular cases then resolve
 * deterministically — measured, not assumed, and pinned by the tests:
 *   - spring forward (02:30 never happens on the last Sunday of March) → the instant one hour
 *     later, i.e. 03:30 local. An access never silently starts a day late.
 *   - fall back (02:30 happens twice on the last Sunday of October) → the SECOND occurrence, the
 *     one in winter time. A start would therefore open an hour later than the first 02:30, and an
 *     end would expire an hour later.
 *
 * That second case is arbitrary, and it is left arbitrary on purpose: it can only ever bite a stay
 * whose check-in or check-out falls between 02:00 and 03:00 on one night of the year, and the
 * house's times are 16:00 and 10:00. Encoding a per-end preference would add a branch nobody can
 * ever observe. What matters is that it cannot drift silently — hence the assertions.
 */
function wallClockToDate(dateStr, timeStr) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  const timeMatch = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '').trim());
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const naive = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!Number.isFinite(naive)) return null;

  let instant = naive - zoneOffsetMs(naive);
  instant = naive - zoneOffsetMs(instant);
  return new Date(instant);
}

/**
 * A `Date` as Europe/Paris wall clock with its numeric offset — `2026-10-06T16:00:00+02:00`. The
 * offset is the one the zone had at that very instant, so both sides of a DST night read right.
 */
function toParisIso(date) {
  const instantMs = date instanceof Date ? date.getTime() : NaN;
  if (!Number.isFinite(instantMs)) return null;
  const offsetMs = zoneOffsetMs(instantMs);
  const wallClock = new Date(instantMs + offsetMs).toISOString().slice(0, 19);
  const offsetMin = Math.round(Math.abs(offsetMs) / 60000);
  const sign = offsetMs < 0 ? '-' : '+';
  const pad = (n) => String(n).padStart(2, '0');
  return `${wallClock}${sign}${pad(Math.floor(offsetMin / 60))}:${pad(offsetMin % 60)}`;
}

/**
 * The window of a stay, or `null` when the reservation cannot yield one (missing dates). Early
 * opening and prolongation are the owner's, set in Sowel's list: they never enter this computation
 * (specs/gate-access-sowel-connector.md §3.1).
 */
function computeWindow(reservation) {
  if (!reservation) return null;

  const checkIn = wallClockToDate(reservation.startDate, reservation.checkInTime || DEFAULT_CHECK_IN);
  const checkOut = wallClockToDate(reservation.endDate, reservation.checkOutTime || DEFAULT_CHECK_OUT);
  if (!checkIn || !checkOut) return null;

  return {
    start: new Date(checkIn.getTime() - OPENS_BEFORE_CHECK_IN_MS),
    end: new Date(checkOut.getTime() + CLOSES_AFTER_CHECK_OUT_MS),
    checkIn,
    checkOut,
  };
}

module.exports = {
  TIME_ZONE,
  OPENS_BEFORE_CHECK_IN_MS,
  CLOSES_AFTER_CHECK_OUT_MS,
  DEFAULT_CHECK_IN,
  DEFAULT_CHECK_OUT,
  computeWindow,
  toParisIso,
  __test: { wallClockToDate, zoneOffsetMs },
};
