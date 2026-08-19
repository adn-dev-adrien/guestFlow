/**
 * icalCancellationModel — pending cancellation approvals for iCal-imported reservations
 * (specs/ical-cancellation-approval.md §4.1, §5).
 *
 * Write paths called from the sync engine:
 *   - `recordPending({reservationId, sourceId, eventUid})` — UPSERT semantics per
 *     reservation. Multiple sources dropping the same reservation in cascade do NOT
 *     duplicate the alert.
 *   - `resolveOnReappearance(pairs)` — batched delete of pending rows whose
 *     `(sourceId, eventUid)` matches an incoming feed event. Fires once at the top of
 *     every sync; if the platform un-cancels a booking the alert disappears silently.
 *
 * Write paths called from the Dashboard controller:
 *   - `approve(id, compensation)` — atomic transaction: snapshot the reservation → history
 *     entry → DELETE FROM reservations → DELETE child ical_import_events mappings → flip the
 *     row to `outcome='approved'`. When `compensation` is given (the platform owes an
 *     indemnity for the cancelled stay, specs/cancellation-compensation.md §3.2), the
 *     compensation row is written in the SAME transaction, from a snapshot read BEFORE the
 *     delete — otherwise there would be nothing left to describe it. Returns 410-shaped error
 *     when the reservation is already gone, mapped by the controller to a 200 idempotent shape
 *     (user already got what they wanted).
 *   - `reject(id)` — flips the row to `outcome='rejected'` without touching the
 *     reservation. The dropped mappings were already removed during the sync that
 *     raised the alert — they are NOT restored on reject (see spec §8).
 *
 * Read path: `listPending()` — joined payload (cancellation × reservation × client ×
 * property × source) for the Dashboard alert. LEFT JOIN so deleted reservations still
 * surface (the user can ignore the row).
 *
 * Factory pattern (`buildModel(database)`) for unit-test isolation, identical to the
 * date-drift model.
 */

function buildModel(database) {
  // Bound to the SAME database so a test factory gets a matching pair. Its statements are
  // prepared lazily, so this stays a no-op on a schema without the compensations table.
  const compensations = require('./cancellationCompensationsModel').buildModel(database);
  const selectPending = database.prepare(`
    SELECT id FROM ical_cancellation_alerts
     WHERE reservationId = ? AND acknowledgedAt IS NULL
     LIMIT 1
  `);
  const insertCancellation = database.prepare(`
    INSERT INTO ical_cancellation_alerts
      (reservationId, sourceId, eventUid, detectedAt)
    VALUES (?, ?, ?, datetime('now'))
  `);
  const refreshCancellation = database.prepare(`
    UPDATE ical_cancellation_alerts
       SET sourceId = ?, eventUid = ?, detectedAt = datetime('now')
     WHERE id = ?
  `);

  /**
   * UPSERT a pending cancellation row for one reservation. The latest `(sourceId, eventUid)`
   * wins so the auto-resolve lookup (rule 4) can match the most recent drop signal.
   */
  function recordPending({ reservationId, sourceId, eventUid }) {
    const existing = selectPending.get(reservationId);
    if (existing) {
      refreshCancellation.run(sourceId, eventUid, existing.id);
      return { id: existing.id, updated: true };
    }
    const result = insertCancellation.run(reservationId, sourceId, eventUid);
    return { id: Number(result.lastInsertRowid), inserted: true };
  }

  /**
   * Batched delete of pending alerts whose `(sourceId, eventUid)` matches an incoming
   * feed event. Called once per sync, BEFORE the per-event loop. Returns the number of
   * auto-resolved rows for logging.
   */
  function resolveOnReappearance(pairs) {
    if (!Array.isArray(pairs) || pairs.length === 0) return 0;
    const filtered = pairs.filter((p) => p && p.sourceId != null && p.eventUid != null);
    if (filtered.length === 0) return 0;
    // SQLite does not support tuple-IN, so we emit one (sourceId, eventUid) clause per pair.
    const placeholders = filtered.map(() => '(sourceId = ? AND eventUid = ?)').join(' OR ');
    const params = filtered.flatMap((p) => [Number(p.sourceId), String(p.eventUid)]);
    const result = database.prepare(`
      DELETE FROM ical_cancellation_alerts
       WHERE acknowledgedAt IS NULL
         AND (${placeholders})
    `).run(...params);
    return Number(result.changes || 0);
  }

  const listPendingStmt = database.prepare(`
    SELECT c.id,
           c.reservationId,
           c.sourceId,
           c.eventUid,
           c.detectedAt,
           r.id IS NOT NULL AS reservationExists,
           r.startDate,
           r.endDate,
           cl.firstName,
           cl.lastName,
           p.name AS propertyName,
           s.name AS sourceName
      FROM ical_cancellation_alerts c
      LEFT JOIN reservations r ON r.id = c.reservationId
      LEFT JOIN clients cl ON cl.id = r.clientId
      LEFT JOIN properties p ON p.id = r.propertyId
      LEFT JOIN ical_sources s ON s.id = c.sourceId
     WHERE c.acknowledgedAt IS NULL
     ORDER BY datetime(c.detectedAt) DESC, c.id DESC
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
        sourceName: row.sourceName || '',
        startDate: row.startDate || '',
        endDate: row.endDate || '',
        detectedAt: row.detectedAt,
        reservationExists: Number(row.reservationExists) === 1,
      };
    });
  }

  const getCancellationById = database.prepare(`
    SELECT id, reservationId, acknowledgedAt
      FROM ical_cancellation_alerts
     WHERE id = ?
  `);
  const reservationExists = database.prepare('SELECT id FROM reservations WHERE id = ?');
  // Everything a cancellation compensation needs to survive the reservation it came from
  // (specs/cancellation-compensation.md §3.1 rule 1). Read INSIDE the approve transaction, before
  // the DELETE — after it there is nothing left to snapshot. Prepared LAZILY: it reaches for columns
  // (finalPrice, platform) that the cancellation unit tests' minimal schema doesn't define, and
  // merely building the model there must not throw — only actually asking for a snapshot may.
  let snapshotStmt = null;
  const selectReservationSnapshot = () => {
    if (!snapshotStmt) {
      snapshotStmt = database.prepare(`
        SELECT r.id, r.propertyId, r.startDate, r.endDate, r.finalPrice, r.platform,
               p.name AS propertyName, c.firstName, c.lastName
          FROM reservations r
          LEFT JOIN properties p ON p.id = r.propertyId
          LEFT JOIN clients c ON c.id = r.clientId
         WHERE r.id = ?
      `);
    }
    return snapshotStmt;
  };
  const insertHistoryStmt = database.prepare(`
    INSERT INTO reservation_history (reservationId, eventType, changedFields)
    VALUES (?, 'delete', ?)
  `);
  const deleteImportEvents = database.prepare(
    'DELETE FROM ical_import_events WHERE reservationId = ?',
  );
  const deleteReservation = database.prepare('DELETE FROM reservations WHERE id = ?');
  const ackApproved = database.prepare(`
    UPDATE ical_cancellation_alerts
       SET acknowledgedAt = datetime('now'), outcome = 'approved'
     WHERE id = ? AND acknowledgedAt IS NULL
  `);
  const ackReservationGone = database.prepare(`
    UPDATE ical_cancellation_alerts
       SET acknowledgedAt = datetime('now'), outcome = 'reservation_gone'
     WHERE id = ? AND acknowledgedAt IS NULL
  `);
  const ackRejected = database.prepare(`
    UPDATE ical_cancellation_alerts
       SET acknowledgedAt = datetime('now'), outcome = 'rejected'
     WHERE id = ? AND acknowledgedAt IS NULL
  `);

  const HISTORY_PAYLOAD = JSON.stringify([
    { field: 'icalCancellationApproved', label: 'Origine', from: null, to: 'Suppression iCal approuvée' },
  ]);

  const approveTx = database.transaction((id, compensation) => {
    const cancellation = getCancellationById.get(id);
    if (!cancellation) return { error: 'INTROUVABLE', status: 404 };
    if (cancellation.acknowledgedAt) return { error: 'DEJA_TRAITE', status: 409 };
    const r = reservationExists.get(cancellation.reservationId);
    if (!r) {
      // Reservation was already deleted between sync and approve — treat as idempotent:
      // ack the row with a distinct outcome so the audit trail records what happened.
      // reservationId still returned so the Google event (if any) gets cleaned up too.
      ackReservationGone.run(id);
      return { ok: true, outcome: 'reservation_gone', reservationId: cancellation.reservationId, compensationId: null };
    }
    // Snapshot BEFORE delete — same reason as the history row below.
    const snapshot = compensation ? selectReservationSnapshot().get(cancellation.reservationId) : null;
    // History BEFORE delete so the reservationId FK is still resolvable.
    insertHistoryStmt.run(cancellation.reservationId, HISTORY_PAYLOAD);
    deleteImportEvents.run(cancellation.reservationId);
    deleteReservation.run(cancellation.reservationId);
    ackApproved.run(id);
    let compensationId = null;
    if (compensation) {
      const created = compensations.create({
        cancellationAlertId: id,
        reservationId: cancellation.reservationId,
        propertyId: snapshot ? snapshot.propertyId : null,
        propertyName: snapshot ? snapshot.propertyName : '',
        platform: snapshot ? snapshot.platform : '',
        clientFirstName: snapshot ? snapshot.firstName : '',
        clientLastName: snapshot ? snapshot.lastName : '',
        startDate: snapshot ? snapshot.startDate : null,
        endDate: snapshot ? snapshot.endDate : null,
        cancelledStayAmount: snapshot ? snapshot.finalPrice : null,
        expectedAmount: compensation.expectedAmount,
        expectedDate: compensation.expectedDate,
        notes: compensation.notes,
      });
      compensationId = created ? created.id : null;
    }
    return { ok: true, outcome: 'approved', reservationId: cancellation.reservationId, compensationId };
  });

  /**
   * @param {number} id                    the pending cancellation alert
   * @param {object|null} compensation     `{ expectedAmount, expectedDate, notes }` when the platform
   *                                       owes an indemnity; omit for the plain "just delete it" path,
   *                                       whose behaviour is unchanged.
   */
  function approve(id, compensation = null) {
    return approveTx(id, compensation || null);
  }

  function reject(id) {
    const cancellation = getCancellationById.get(id);
    if (!cancellation) return { error: 'INTROUVABLE', status: 404 };
    if (cancellation.acknowledgedAt) return { error: 'DEJA_TRAITE', status: 409 };
    ackRejected.run(id);
    return { ok: true };
  }

  return { recordPending, resolveOnReappearance, listPending, approve, reject };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
