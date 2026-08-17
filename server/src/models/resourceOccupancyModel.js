/**
 * Unified resource occupancy — the single answer to « what is using this resource, and when? »
 * (specs/hourly-resource-quantity-and-sas-scheduling.md §3.5).
 *
 * A resource is occupied by two different things, stored in two different places:
 *   - **standalone bookings** (`resource_bookings`) — the « extérieurs » a host books directly;
 *   - **guest sessions** (`reservation_resources.sessions`, JSON) — hours placed on a reservation.
 *
 * They used to be reconciled nowhere: `countConflicts` only ever looked at `resource_bookings`, so a
 * standalone booking could be created straight on top of a guest session, and the planning page
 * papered over it by merging the two lists in React. This model is the seam that fixes it once for
 * all three consumers — the planning view, the standalone-booking writes, and the arrival SAS picker.
 *
 * Every row comes back in the same shape: `{ date, start, end, kind, reservationId, bookingId }`.
 * No client identity is ever included — the SAS picker is shown with the guest standing there
 * (§3.4 rule 19), and no consumer needs it to decide whether a slot is free.
 */

const db = require('../database');
const { formatTimeShort } = require('../utils/dateFr');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function createModel(database) {
  const hasColumn = (table, column) => {
    try { return database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column); }
    catch { return false; }
  };
  const HAS_SESSIONS = hasColumn('reservation_resources', 'sessions');

  function parseSessions(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    let list;
    try { list = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => ({
        date: String(s?.date || '').slice(0, 10),
        start: formatTimeShort(s?.start) || '',
        end: formatTimeShort(s?.end) || '',
      }))
      .filter((s) => ISO_DATE.test(s.date) && s.start && s.end);
  }

  /**
   * Every occupancy of `resourceId` between `from` and `to` (inclusive ISO dates).
   *
   * `excludeReservationId` drops the booking being edited — its own hours must not block themselves,
   * exactly like `excludeBookingId` does for a standalone slot.
   */
  function listRange({ resourceId, from, to, excludeBookingId = null, excludeReservationId = null }) {
    const rid = Number(resourceId);
    if (!rid || !ISO_DATE.test(String(from)) || !ISO_DATE.test(String(to))) return [];

    const bookings = database.prepare(`
      SELECT id, date, startTime, endTime, reservationId
      FROM resource_bookings
      WHERE resourceId = ? AND date >= ? AND date <= ?
      ORDER BY date, startTime
    `).all(rid, from, to)
      .filter((b) => !excludeBookingId || Number(b.id) !== Number(excludeBookingId))
      .filter((b) => !excludeReservationId || Number(b.reservationId || 0) !== Number(excludeReservationId))
      .map((b) => ({
        date: b.date,
        start: formatTimeShort(b.startTime) || '',
        end: formatTimeShort(b.endTime) || '',
        kind: 'booking',
        bookingId: Number(b.id),
        reservationId: b.reservationId ? Number(b.reservationId) : null,
      }))
      .filter((b) => b.start && b.end);

    if (!HAS_SESSIONS) return bookings;

    // Devis are excluded on purpose: a quote reserves no slot until it becomes a reservation, the
    // same rule the planning cards already apply.
    const sessionRows = database.prepare(`
      SELECT rr.reservationId AS reservationId, rr.sessions AS sessions
      FROM reservation_resources rr
      JOIN reservations res ON res.id = rr.reservationId
      WHERE rr.resourceId = ?
        AND res.kind = 'reservation'
        AND rr.sessions IS NOT NULL
        AND TRIM(rr.sessions) != ''
    `).all(rid);

    const sessions = [];
    for (const row of sessionRows) {
      if (excludeReservationId && Number(row.reservationId) === Number(excludeReservationId)) continue;
      for (const session of parseSessions(row.sessions)) {
        if (session.date < from || session.date > to) continue;
        sessions.push({
          date: session.date,
          start: session.start,
          end: session.end,
          kind: 'session',
          bookingId: null,
          reservationId: Number(row.reservationId),
        });
      }
    }

    return [...bookings, ...sessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  }

  /**
   * Occupancy over a stay, plus the day before it. The extra day is what lets the thermal model see a
   * use that ended late the previous evening and is still keeping the resource warm
   * (§3.3 rule 12, cross-midnight look-back).
   */
  function listForStay({ resourceId, startDate, endDate, excludeReservationId = null }) {
    if (!ISO_DATE.test(String(startDate))) return [];
    return listRange({
      resourceId,
      from: addDays(startDate, -1),
      to: ISO_DATE.test(String(endDate)) ? endDate : startDate,
      excludeReservationId,
    });
  }

  /**
   * Turnover-aware overlap count on one date — the check that decides whether a slot is bookable.
   * Same predicate as the SQL `countConflicts` has always used, now applied to bookings AND sessions.
   */
  function countConflicts({ resourceId, date, startTime, endTime, turnover = 0, excludeBookingId = null, excludeReservationId = null }) {
    const buffer = Math.max(0, Number(turnover) || 0);
    const toMin = (t) => {
      const [h, m] = String(t || '').split(':').map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const start = toMin(startTime);
    const end = toMin(endTime);
    return listRange({ resourceId, from: date, to: date, excludeBookingId, excludeReservationId })
      .filter((item) => toMin(item.start) < end + buffer && toMin(item.end) + buffer > start)
      .length;
  }

  return { listRange, listForStay, countConflicts, parseSessions };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
