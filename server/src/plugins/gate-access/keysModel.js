/**
 * Gate keys — guestFlow's storage for the Sowel connector (specs/gate-access-sowel-connector.md §5).
 *
 * Two tables and nothing that decides about the gate:
 *   - `gate_key_results`: the LATEST outcome the house reported for each reservation (rules 9-12);
 *   - `gate_connector_state`: when the house last read the list, and whether the admins were already
 *     told it stopped (rules 17-18).
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const { roles } = require('../sdk');

const { ADMIN } = roles;

function createGateKeysModel(db) {
  const clean = (value) => (value === undefined || value === null || value === '' ? null : String(value));

  function ensureStateRow() {
    db.prepare('INSERT OR IGNORE INTO gate_connector_state (id) VALUES (1)').run();
  }

  return {
    get(reservationId) {
      return db.prepare('SELECT * FROM gate_key_results WHERE reservationId = ?').get(Number(reservationId)) || null;
    },

    all() {
      return db.prepare('SELECT * FROM gate_key_results ORDER BY reservationId').all();
    },

    /**
     * Replaces the reservation's result with the one just received (rule 9). The listed window is
     * kept from the previous row when the new one carries none — that is what lets a deleted
     * reservation still be revoked (rule 6). `alertedError` is left to the caller: it is the alert
     * bookkeeping, not part of the outcome.
     */
    upsertResult(result) {
      db.prepare(`
        INSERT INTO gate_key_results
          (reservationId, action, ok, state, code, url, error, message, label, startsAt, endsAt, receivedAt)
        VALUES
          (@reservationId, @action, @ok, @state, @code, @url, @error, @message, @label, @startsAt, @endsAt, @receivedAt)
        ON CONFLICT(reservationId) DO UPDATE SET
          action = excluded.action,
          ok = excluded.ok,
          state = excluded.state,
          code = excluded.code,
          url = excluded.url,
          error = excluded.error,
          message = excluded.message,
          label = COALESCE(excluded.label, gate_key_results.label),
          startsAt = COALESCE(excluded.startsAt, gate_key_results.startsAt),
          endsAt = COALESCE(excluded.endsAt, gate_key_results.endsAt),
          receivedAt = excluded.receivedAt
      `).run({
        reservationId: Number(result.reservationId),
        action: String(result.action),
        ok: result.ok ? 1 : 0,
        state: clean(result.state),
        code: clean(result.code),
        url: clean(result.url),
        error: clean(result.error),
        message: clean(result.message),
        label: clean(result.label),
        startsAt: clean(result.startsAt),
        endsAt: clean(result.endsAt),
        receivedAt: String(result.receivedAt),
      });
    },

    setAlertedError(reservationId, error) {
      db.prepare('UPDATE gate_key_results SET alertedError = ? WHERE reservationId = ?')
        .run(clean(error), Number(reservationId));
    },

    /** Failures still worth an alert: the stay has not ended (rule 13). */
    failures(nowIso) {
      return db.prepare(`
        SELECT * FROM gate_key_results
        WHERE ok = 0 AND (endsAt IS NULL OR endsAt > ?)
        ORDER BY startsAt, reservationId
      `).all(String(nowIso));
    },

    /** Keys the house reports as created and not revoked since (the settings card). */
    countCreated() {
      return Number(db.prepare(
        "SELECT COUNT(*) AS n FROM gate_key_results WHERE action = 'create' AND ok = 1",
      ).get().n || 0);
    },

    readState() {
      const row = db.prepare('SELECT lastReadAt, staleAlertedAt FROM gate_connector_state WHERE id = 1').get();
      return { lastReadAt: row ? row.lastReadAt || null : null, staleAlertedAt: row ? row.staleAlertedAt || null : null };
    },

    /** A read of the list: stamps it, and clears the « not read » alert (rule 18). */
    recordRead(nowIso) {
      ensureStateRow();
      db.prepare('UPDATE gate_connector_state SET lastReadAt = ?, staleAlertedAt = NULL WHERE id = 1').run(String(nowIso));
    },

    markStaleAlerted(nowIso) {
      ensureStateRow();
      db.prepare('UPDATE gate_connector_state SET staleAlertedAt = ? WHERE id = 1').run(String(nowIso));
    },

    /** Every active admin — the recipients of the connector's pushes (rule 14). */
    adminUserIds() {
      return db.prepare(`
        SELECT DISTINCT u.id FROM users u
        JOIN user_roles r ON r.userId = u.id
        WHERE u.isActive = 1 AND r.role = ?
        ORDER BY u.id
      `).all(ADMIN).map((row) => Number(row.id));
    },

    /**
     * The stays that may need a key: live reservations around now, and every cancelled or deleted one
     * guestFlow holds a result for. The date filter is a coarse pre-selection on calendar days; the
     * exact instants are decided by `utils/gateKeys.js`.
     */
    activeStaysAround(fromYmd, toYmd) {
      return db.prepare(`
        SELECT r.id, r.reservationNumber, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
               p.name AS propertyName, c.firstName AS clientFirstName,
               g.action AS resultAction, g.ok AS resultOk
        FROM reservations r
        LEFT JOIN properties p ON p.id = r.propertyId
        LEFT JOIN clients c ON c.id = r.clientId
        LEFT JOIN gate_key_results g ON g.reservationId = r.id
        WHERE r.kind = 'reservation'
          AND r.endDate >= ?
          AND (r.startDate <= ? OR g.reservationId IS NOT NULL)
        ORDER BY r.startDate, r.id
      `).all(String(fromYmd), String(toYmd));
    },

    /** Results whose reservation is no longer a live one: cancelled, deleted (or anything else). */
    resultsWithoutLiveStay() {
      return db.prepare(`
        SELECT g.*, r.id AS rowId, r.reservationNumber, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
               p.name AS propertyName, c.firstName AS clientFirstName
        FROM gate_key_results g
        LEFT JOIN reservations r ON r.id = g.reservationId
        LEFT JOIN properties p ON p.id = r.propertyId
        LEFT JOIN clients c ON c.id = r.clientId
        WHERE r.id IS NULL OR r.kind <> 'reservation'
        ORDER BY g.reservationId
      `).all();
    },

    /** What the label of a reservation is built from, when it still exists. */
    stayFor(reservationId) {
      return db.prepare(`
        SELECT r.id, r.kind, r.reservationNumber, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
               p.name AS propertyName, c.firstName AS clientFirstName
        FROM reservations r
        LEFT JOIN properties p ON p.id = r.propertyId
        LEFT JOIN clients c ON c.id = r.clientId
        WHERE r.id = ?
      `).get(Number(reservationId)) || null;
    },
  };
}

module.exports = createGateKeysModel;
module.exports.createGateKeysModel = createGateKeysModel;
