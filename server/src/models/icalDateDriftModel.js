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

function buildModel(database) {
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
    SELECT id, startDate, endDate
      FROM reservations
     WHERE id = ?
  `);
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
    narrowDateUpdate.run(drift.newStartDate, drift.newEndDate, drift.reservationId);
    insertHistoryStmt.run(drift.reservationId, buildDateHistoryPayload(
      reservation.startDate, reservation.endDate, drift.newStartDate, drift.newEndDate,
    ));
    ackApproved.run(id);
    return { ok: true };
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
