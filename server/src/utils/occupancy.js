/**
 * Pure occupancy / availability helpers for reservations (no DB access).
 *
 * Night-block thresholds: a checkout ≥ 17h occupies the departure night (blocks the next day's
 * arrival); a check-in ≤ 10h needs the pre-arrival night (blocks the previous day's departure).
 */

const LATE_CHECKOUT_BLOCK_HOUR = 17;
const EARLY_CHECKIN_BLOCK_HOUR = 10;

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

function addIsoDays(dateStr, deltaDays) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
}

function getNightBlocksFromTimes(checkInTime, checkOutTime) {
  return {
    blocksPreviousNight: timeToHour(checkInTime || '15:00') <= EARLY_CHECKIN_BLOCK_HOUR ? 1 : 0,
    blocksNextNight: timeToHour(checkOutTime || '10:00') >= LATE_CHECKOUT_BLOCK_HOUR ? 1 : 0,
  };
}

// The nights a stay really takes: an early check-in takes the night before, a late check-out the night
// after. This is what the availability check refuses, so it is what the iCal export must publish.
function effectiveRange(row) {
  const { blocksPreviousNight, blocksNextNight } = getNightBlocksFromTimes(row.checkInTime, row.checkOutTime);
  return {
    startDate: blocksPreviousNight ? addIsoDays(row.startDate, -1) : row.startDate,
    endDate: blocksNextNight ? addIsoDays(row.endDate, 1) : row.endDate,
  };
}

// Columns to select to feed `effectiveRange`; a minimal schema without the times simply has none.
function timeColumnsOf(database) {
  const names = new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
  return ['checkInTime', 'checkOutTime'].filter((c) => names.has(c));
}

function buildOccupiedDatesFromReservations(reservations) {
  const occupiedDates = new Set();

  for (const reservation of reservations || []) {
    const { blocksPreviousNight, blocksNextNight } = getNightBlocksFromTimes(
      reservation.checkInTime,
      reservation.checkOutTime,
    );

    const effectiveStart = blocksPreviousNight
      ? addIsoDays(reservation.startDate, -1)
      : String(reservation.startDate || '');
    const effectiveEndExclusive = blocksNextNight
      ? addIsoDays(reservation.endDate, 1)
      : String(reservation.endDate || '');

    let cursor = effectiveStart;
    while (cursor && effectiveEndExclusive && cursor < effectiveEndExclusive) {
      occupiedDates.add(cursor);
      cursor = addIsoDays(cursor, 1);
    }
  }

  return Array.from(occupiedDates).filter(Boolean).sort();
}

/** True iff any night in [start, end) is blocked. Pure given the blocked set. */
function rangeHasBlockedNight(start, end, blockedDates) {
  const set = blockedDates instanceof Set ? blockedDates : new Set(blockedDates || []);
  let cursor = start;
  while (cursor && cursor < end) {
    if (set.has(cursor)) return true;
    cursor = addIsoDays(cursor, 1);
  }
  return false;
}

module.exports = {
  rangeHasBlockedNight,
  LATE_CHECKOUT_BLOCK_HOUR,
  EARLY_CHECKIN_BLOCK_HOUR,
  timeToHour,
  addIsoDays,
  getNightBlocksFromTimes,
  effectiveRange,
  timeColumnsOf,
  buildOccupiedDatesFromReservations,
};
