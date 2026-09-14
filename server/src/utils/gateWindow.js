/**
 * The validity window of a guest gate access (specs/guest-gate-access.md §3.2).
 *
 *   start = startDate + checkInTime      (no tolerance before check-in — decision 2026-09-09)
 *   end   = endDate   + checkOutTime + 1 h
 *
 * Both ends are **Europe/Paris wall clock**, because that is what is written on the contract and
 * what the guest reads. It is computed from the live reservation and pushed to Portier whenever the
 * dates, the times or the lodging change (specs/gate-access-portier.md §3.1): moving the dates moves
 * the access with them, with no operator action (§3.2 rule 7).
 *
 * Why the conversion is not `new Date('2026-09-12T16:00')`: that parses in the *server's* zone.
 * The VM is on Europe/Paris today, but the app also runs in CI and on a laptop, and a booking
 * straddling the last Sunday of March must still open at 16:00 local. So the wall clock is
 * resolved against the zone explicitly, through the offset the zone actually had at that instant.
 */

const TIME_ZONE = 'Europe/Paris';
const ONE_HOUR_MS = 60 * 60 * 1000;

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
 * The window of a stay, or `null` when the reservation cannot yield one (missing dates). Early
 * opening and prolongation are the owner's, set in Portier's list: they never enter this computation
 * (specs/gate-access-portier.md §3.1).
 */
function computeWindow(reservation) {
  if (!reservation) return null;

  const start = wallClockToDate(reservation.startDate, reservation.checkInTime || DEFAULT_CHECK_IN);
  const checkOut = wallClockToDate(reservation.endDate, reservation.checkOutTime || DEFAULT_CHECK_OUT);
  if (!start || !checkOut) return null;

  return { start, end: new Date(checkOut.getTime() + ONE_HOUR_MS), checkOut };
}

module.exports = {
  TIME_ZONE,
  DEFAULT_CHECK_IN,
  DEFAULT_CHECK_OUT,
  computeWindow,
  __test: { wallClockToDate, zoneOffsetMs },
};
