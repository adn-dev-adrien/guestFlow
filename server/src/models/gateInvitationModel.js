/**
 * The local copy of the invitations (specs/gate-access-sowel-connector.md §3.2).
 *
 * It is a COPY, pushed by the house. Nothing here is authoritative and nothing here opens a gate:
 * the code is only a string to display, and the house would refuse it if it were stale. It exists
 * for one precise reason — the J-7 email, the SAS and the fiche must know what to show **without
 * reaching the house**, which accepts no incoming connection at all. That is exactly what used to
 * make emails wait in the previous version.
 */

function createGateInvitationModel(db) {
  const COLUMNS = [
    'reservationId', 'accessId', 'state', 'code', 'url',
    'validFrom', 'validUntil', 'devices', 'lastUsedAt', 'updatedAt',
  ];

  const clean = (value) => (value === undefined || value === null || value === '' ? null : String(value));

  return {
    /** What the house has just pushed for a stay. Replaces everything — it is authoritative. */
    upsert(invitation) {
      const reservationId = Number(invitation.reservationId);
      if (!Number.isInteger(reservationId) || reservationId <= 0) return null;
      const row = {
        reservationId,
        accessId: clean(invitation.accessId),
        state: clean(invitation.state) || 'unknown',
        code: clean(invitation.code),
        url: clean(invitation.url),
        validFrom: clean(invitation.validFrom),
        validUntil: clean(invitation.validUntil),
        devices: Number(invitation.devices) || 0,
        lastUsedAt: clean(invitation.lastUsedAt),
        updatedAt: clean(invitation.updatedAt),
        receivedAt: new Date().toISOString(),
      };
      db.prepare(`
        INSERT INTO gate_invitations (${COLUMNS.join(', ')}, receivedAt)
        VALUES (@${COLUMNS.join(', @')}, @receivedAt)
        ON CONFLICT(reservationId) DO UPDATE SET
          accessId = excluded.accessId,
          state = excluded.state,
          code = excluded.code,
          url = excluded.url,
          validFrom = excluded.validFrom,
          validUntil = excluded.validUntil,
          devices = excluded.devices,
          lastUsedAt = excluded.lastUsedAt,
          updatedAt = excluded.updatedAt,
          receivedAt = excluded.receivedAt
      `).run(row);
      return row;
    },

    get(reservationId) {
      const row = db.prepare('SELECT * FROM gate_invitations WHERE reservationId = ?').get(Number(reservationId));
      return row || null;
    },

    /**
     * The one a surface may show: not deleted from the list, not revoked, not finished. The rest of
     * the time we say nothing rather than print a dead code.
     */
    usable(reservationId) {
      const row = this.get(reservationId);
      if (!row) return null;
      if (['deleted', 'revoked', 'ended'].includes(String(row.state))) return null;
      if (!row.code) return null;
      return row;
    },

    /** When the house last spoke — the settings page shows it. */
    lastReceivedAt() {
      const row = db.prepare('SELECT MAX(receivedAt) AS at FROM gate_invitations').get();
      return row && row.at ? String(row.at) : null;
    },

    count() {
      return Number(db.prepare('SELECT COUNT(*) AS n FROM gate_invitations').get().n || 0);
    },
  };
}

module.exports = createGateInvitationModel;
module.exports.createGateInvitationModel = createGateInvitationModel;
/** The application's instance, bound to the real database. */
let defaultModel = null;
module.exports.model = () => {
  if (!defaultModel) defaultModel = createGateInvitationModel(require('../database'));
  return defaultModel;
};
