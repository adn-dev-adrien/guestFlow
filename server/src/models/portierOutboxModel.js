/**
 * Portier outbox — sole DB access for `portier_outbox` (specs/gate-access-portier.md §3.1 + §5).
 *
 * Factory only, deliberately without a default instance: it is reached from models that
 * database.js itself loads, and a default instance would require database.js back mid-load.
 *
 * API (all timestamps ISO strings):
 *   insert({ reservationId, type, payload, createdAt })      → id (the push's revision)
 *   listPending()                                             → unsent rows, oldest first
 *   markSent(id, { sentAt, lastError? })                      → Portier answered (lastError = a refusal)
 *   markFailed(id, { attempts, nextAttemptAt, lastError })    → no usable answer, retry later
 *   nextRetryAt()                                             → earliest retry among failed rows, or null
 *   failingSince(reservationId, { before })                   → oldest failing row created before `before`
 *   failingSummary({ before })                                → { reservations, since } or null
 *   lastRow(reservationId)                                    → the latest row of a reservation
 *   purgeSent(before)                                         → rows answered before `before` are dropped
 */

function buildModel(database) {
  const insertStmt = database.prepare(`
    INSERT INTO portier_outbox (reservationId, type, payload, createdAt)
    VALUES (@reservationId, @type, @payload, @createdAt)
  `);
  const listPendingStmt = database.prepare(`
    SELECT id, reservationId, type, payload, attempts, nextAttemptAt, lastError, createdAt, sentAt
      FROM portier_outbox
     WHERE sentAt IS NULL
     ORDER BY id
  `);
  const markSentStmt = database.prepare(`
    UPDATE portier_outbox SET sentAt = ?, lastError = ?, nextAttemptAt = NULL WHERE id = ?
  `);
  const markFailedStmt = database.prepare(`
    UPDATE portier_outbox SET attempts = ?, nextAttemptAt = ?, lastError = ? WHERE id = ?
  `);
  const nextRetryStmt = database.prepare(`
    SELECT MIN(nextAttemptAt) AS at FROM portier_outbox WHERE sentAt IS NULL AND nextAttemptAt IS NOT NULL
  `);
  const failingSinceStmt = database.prepare(`
    SELECT MIN(createdAt) AS since FROM portier_outbox
     WHERE sentAt IS NULL AND attempts > 0 AND reservationId = ? AND createdAt <= ?
  `);
  const failingSummaryStmt = database.prepare(`
    SELECT COUNT(DISTINCT COALESCE(reservationId, 0)) AS reservations, MIN(createdAt) AS since
      FROM portier_outbox
     WHERE sentAt IS NULL AND attempts > 0 AND createdAt <= ?
  `);
  const lastRowStmt = database.prepare(`
    SELECT id, reservationId, type, attempts, lastError, createdAt, sentAt
      FROM portier_outbox WHERE reservationId = ? ORDER BY id DESC LIMIT 1
  `);
  const purgeStmt = database.prepare('DELETE FROM portier_outbox WHERE sentAt IS NOT NULL AND sentAt < ?');

  return {
    insert({ reservationId = null, type, payload, createdAt }) {
      const info = insertStmt.run({
        reservationId: reservationId == null ? null : Number(reservationId),
        type: String(type),
        payload: JSON.stringify(payload || {}),
        createdAt: String(createdAt),
      });
      return Number(info.lastInsertRowid);
    },

    listPending() {
      return listPendingStmt.all();
    },

    markSent(id, { sentAt, lastError = '' }) {
      markSentStmt.run(String(sentAt), String(lastError || ''), Number(id));
    },

    markFailed(id, { attempts, nextAttemptAt, lastError }) {
      markFailedStmt.run(Number(attempts), String(nextAttemptAt), String(lastError || ''), Number(id));
    },

    nextRetryAt() {
      const row = nextRetryStmt.get();
      return row && row.at ? row.at : null;
    },

    failingSince(reservationId, { before }) {
      const row = failingSinceStmt.get(Number(reservationId), String(before));
      return row && row.since ? row.since : null;
    },

    failingSummary({ before }) {
      const row = failingSummaryStmt.get(String(before));
      if (!row || !row.since) return null;
      return { reservations: Number(row.reservations), since: row.since };
    },

    lastRow(reservationId) {
      return lastRowStmt.get(Number(reservationId)) || null;
    },

    purgeSent(before) {
      return purgeStmt.run(String(before)).changes;
    },
  };
}

module.exports = { buildModel };
