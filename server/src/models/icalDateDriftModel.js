/**
 * icalDateDriftModel — pending date-drift approvals for iCal-locked reservations
 * (specs/ical-sync-override-locked-dates.md §4.1, §5).
 *
 * Two write paths:
 *   - `recordPending` — called from the sync engine when a locked reservation's source dates
 *     diverge from its persisted dates. UPSERT semantics per reservationId so the alert is not
 *     duplicated when the source shuffles again before the user reacts.
 *   - `approve(id)` — atomically rewrites the reservation's date fields (narrow override per
 *     spec §3 rules 6+7), flips the drift row to `outcome='approved'`, and inserts a
 *     reservation_history audit entry. Returns a `{ ok }` / `{ error, status }` shape so the
 *     controller maps to the right HTTP status.
 *   - `reject(id)` — flips the row to `outcome='rejected'` without touching the reservation.
 *
 * One read path:
 *   - `listPending()` — returns rows joined with reservation + client + property for the
 *     Dashboard alert. Uses LEFT JOIN so a deleted reservation still surfaces (the user can
 *     ignore the row).
 *
 * Factory pattern (`buildModel(database)`) for unit-test isolation.
 */

const { classifyBookingEvent } = require('../utils/icalBookingEcho');
const { effectiveRange, timeColumnsOf } = require('../utils/occupancy');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { isDirectChannel } = require('../utils/platformNameFormat');

function buildModel(database) {
  const reservationColumns = new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
  const has = (name) => reservationColumns.has(name);
  const selectPending = database.prepare(`
    SELECT id, reservationId, newStartDate, newEndDate
      FROM ical_date_drift_alerts
     WHERE reservationId = ? AND acknowledgedAt IS NULL
     LIMIT 1
  `);
  const insertDrift = database.prepare(`
    INSERT INTO ical_date_drift_alerts
      (reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate, detectedAt)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  const refreshDrift = database.prepare(`
    UPDATE ical_date_drift_alerts
       SET newStartDate = ?, newEndDate = ?, detectedAt = datetime('now')
     WHERE id = ?
  `);

  /**
   * UPSERT a pending drift row for one reservation. previousStart/End are stored once (on the
   * first INSERT) — they reflect the dates the reservation currently has. newStart/End are
   * always overwritten with the latest source proposal.
   */
  function recordPending({ reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate }) {
    const existing = selectPending.get(reservationId);
    if (existing) {
      // Same proposal as before → don't bump detectedAt (keep the original alert age).
      if (existing.newStartDate === newStartDate && existing.newEndDate === newEndDate) {
        return { id: existing.id, updated: false };
      }
      refreshDrift.run(newStartDate, newEndDate, existing.id);
      return { id: existing.id, updated: true };
    }
    const result = insertDrift.run(reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate);
    return { id: Number(result.lastInsertRowid), inserted: true };
  }

  const listPendingStmt = database.prepare(`
    SELECT d.id,
           d.reservationId,
           d.previousStartDate,
           d.previousEndDate,
           d.newStartDate,
           d.newEndDate,
           d.detectedAt,
           r.id IS NOT NULL AS reservationExists,
           c.firstName,
           c.lastName,
           p.name AS propertyName
      FROM ical_date_drift_alerts d
      LEFT JOIN reservations r ON r.id = d.reservationId
      LEFT JOIN clients c ON c.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
     WHERE d.acknowledgedAt IS NULL
     ORDER BY datetime(d.detectedAt) DESC, d.id DESC
  `);

  function listPending() {
    return listPendingStmt.all().map((row) => {
      const firstName = String(row.firstName || '').trim();
      const lastName = String(row.lastName || '').trim();
      const clientName = `${firstName} ${lastName}`.trim();
      return {
        id: row.id,
        reservationId: row.reservationId,
        clientName: clientName || `#${row.reservationId}`,
        propertyName: row.propertyName || '',
        previousStartDate: row.previousStartDate,
        previousEndDate: row.previousEndDate,
        newStartDate: row.newStartDate,
        newEndDate: row.newEndDate,
        detectedAt: row.detectedAt,
        reservationExists: Number(row.reservationExists) === 1,
      };
    });
  }

  const getDriftById = database.prepare(`
    SELECT id, reservationId, newStartDate, newEndDate, acknowledgedAt
      FROM ical_date_drift_alerts
     WHERE id = ?
  `);
  const getReservationCore = database.prepare(`
    SELECT ${['id', 'startDate', 'endDate', 'kind', 'propertyId', 'platform', 'bookingConflictAt']
    .filter((c) => c === 'id' || c === 'startDate' || c === 'endDate' || c === 'propertyId' || has(c)).join(', ')}
      FROM reservations
     WHERE id = ?
  `);

  // What the approved dates would sit on: the property's other stays and its closures, as the sync
  // judges a moved stay (specs/ical-import-hardening.md rule 3).
  function overlapsTakenNights(reservation, startDate, endDate) {
    const stay = { startDate, endDate };
    const others = has('kind')
      ? database.prepare(`SELECT ${['startDate', 'endDate', ...timeColumnsOf(database)].join(', ')} FROM reservations WHERE propertyId = ? AND kind = 'reservation' AND id != ?`)
        .all(reservation.propertyId, reservation.id).map((r) => effectiveRange(r))
      : [];
    let closures = [];
    try {
      closures = database.prepare('SELECT startDate, endDate FROM establishment_closures WHERE propertyId IS NULL OR propertyId = ?').all(reservation.propertyId);
    } catch { closures = []; }
    return classifyBookingEvent(stay, others) !== 'free' || classifyBookingEvent(stay, closures) !== 'free';
  }

  // A platform stay's balance date is the platform's payout deadline: it follows the departure.
  function payoutDeadlineFor(reservation, endDate) {
    if (!has('balanceDueDate') || !reservation.platform || isDirectChannel(reservation.platform)) return undefined;
    try {
      const days = require('./platformsModel').create(database).getPayoutDueDays(reservation.platform);
      return addDaysToIsoDate(endDate, days);
    } catch { return undefined; }
  }
  // Narrow date override — see spec §3 rules 6+7. Touches ONLY the date fields and
  // metadata; the price, capacity, bed, options/resources/payment fields are untouched.
  const narrowDateUpdate = database.prepare(`
    UPDATE reservations
       SET startDate = ?, endDate = ?, updatedAt = datetime('now')
     WHERE id = ?
  `);
  const ackApproved = database.prepare(`
    UPDATE ical_date_drift_alerts
       SET acknowledgedAt = datetime('now'), outcome = 'approved'
     WHERE id = ? AND acknowledgedAt IS NULL
  `);
  const ackRejected = database.prepare(`
    UPDATE ical_date_drift_alerts
       SET acknowledgedAt = datetime('now'), outcome = 'rejected'
     WHERE id = ? AND acknowledgedAt IS NULL
  `);
  const insertHistoryStmt = database.prepare(`
    INSERT INTO reservation_history (reservationId, eventType, changedFields)
    VALUES (?, 'update', ?)
  `);

  function buildDateHistoryPayload(prevStart, prevEnd, newStart, newEnd) {
    const changes = [];
    if (prevStart !== newStart) {
      changes.push({ field: 'startDate', label: 'Date d\'arrivée', from: prevStart, to: newStart });
    }
    if (prevEnd !== newEnd) {
      changes.push({ field: 'endDate', label: 'Date de départ', from: prevEnd, to: newEnd });
    }
    changes.push({ field: 'icalDateDriftApproved', label: 'Origine', from: null, to: 'Dates iCal approuvées' });
    return JSON.stringify(changes);
  }

  const approveTx = database.transaction((id) => {
    const drift = getDriftById.get(id);
    if (!drift) return { error: 'INTROUVABLE', status: 404 };
    if (drift.acknowledgedAt) return { error: 'DEJA_TRAITE', status: 409 };
    const reservation = getReservationCore.get(drift.reservationId);
    if (!reservation) {
      // Reservation deleted while the drift was pending: we cannot apply the override, but the
      // row is left pending so the user can still Reject it from the alert.
      return { error: 'RESERVATION_SUPPRIMEE', status: 410 };
    }
    if (has('kind') && reservation.kind !== 'reservation') {
      return { error: 'RESERVATION_NON_ACTIVE', status: 409 };
    }
    narrowDateUpdate.run(drift.newStartDate, drift.newEndDate, drift.reservationId);
    const deadline = payoutDeadlineFor(reservation, drift.newEndDate);
    if (deadline) database.prepare('UPDATE reservations SET balanceDueDate = ? WHERE id = ?').run(deadline, drift.reservationId);
    const conflict = overlapsTakenNights(reservation, drift.newStartDate, drift.newEndDate);
    if (has('bookingConflictAt')) {
      if (conflict) database.prepare('UPDATE reservations SET bookingConflictAt = ? WHERE id = ? AND bookingConflictAt IS NULL').run(new Date().toISOString(), drift.reservationId);
      else if (reservation.bookingConflictAt) database.prepare('UPDATE reservations SET bookingConflictAt = NULL WHERE id = ?').run(drift.reservationId);
    }
    insertHistoryStmt.run(drift.reservationId, buildDateHistoryPayload(
      reservation.startDate, reservation.endDate, drift.newStartDate, drift.newEndDate,
    ));
    ackApproved.run(id);
    // reservationId feeds the controller's Google Calendar push hook (additive, spec rule 20).
    return { ok: true, reservationId: drift.reservationId, ...(conflict && has('bookingConflictAt') && !reservation.bookingConflictAt ? { conflict: true } : {}) };
  });

  function approve(id) {
    return approveTx(id);
  }

  function reject(id) {
    const drift = getDriftById.get(id);
    if (!drift) return { error: 'INTROUVABLE', status: 404 };
    if (drift.acknowledgedAt) return { error: 'DEJA_TRAITE', status: 409 };
    ackRejected.run(id);
    return { ok: true };
  }

  return { recordPending, listPending, approve, reject };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
