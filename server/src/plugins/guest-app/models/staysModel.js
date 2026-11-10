/**
 * The reservation fields a guest session may read (specs/guest-app.md rule 8). The SELECT is the
 * minimisation: no e-mail, phone, address or amount ever enters the plugin's session path. A row of any
 * `kind` is returned: `currentStay.js` decides what is live.
 */

const COLUMNS = `
  r.id, r.kind, r.propertyId, r.platform, r.reservationNumber, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
  r.adults, r.teens, r.children, r.babies,
  c.firstName AS clientFirstName, c.lastName AS clientLastName, c.emailLanguage AS clientLanguage
`;

function createStaysModel(db) {
  return {
    byId(id) {
      return db.prepare(`SELECT ${COLUMNS} FROM reservations r LEFT JOIN clients c ON c.id = r.clientId WHERE r.id = ?`)
        .get(Number(id)) || null;
    },

    /** Rule 87 — the reception amends only the arrival SAS of the day that was never committed. */
    arrivalRow(id) {
      return db.prepare('SELECT arrivalSasDoneAt FROM reservations WHERE id = ?').get(Number(id)) || null;
    },

    /**
     * Rule 76 — where the stay's arrival complement stands, from its stored markers alone (no amount enters the
     * plugin; `SELECT *` because a minimal schema may predate a marker): `collected` (paid, in cash or not), `deferred` to the departure, else `open`.
     */
    arrivalComplementState(id) {
      const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
      if (!row) return null;
      if (Number(row.complementPaid) === 1 || Number(row.complementPaidCash) === 1) return 'collected';
      return Number(row.complementDeferredToCheckout) === 1 ? 'deferred' : 'open';
    },

    /** Rule 71 — what the arrival complement now asks (net of the orders paid by card), to tell a lowered fiche from the orders' snapshots. */
    arrivalComplementAmount(id) {
      const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
      return row ? Math.round((Number(row.complementAmount) || 0) * 100) / 100 : 0;
    },

    /** Rule 6 — every live reservation carrying the number: two stays may share one, the name tells them apart. */
    byReservationNumber(number) {
      return db.prepare(`
        SELECT ${COLUMNS} FROM reservations r LEFT JOIN clients c ON c.id = r.clientId
        WHERE r.reservationNumber = ? COLLATE NOCASE AND r.kind = 'reservation' ORDER BY r.id
      `).all(String(number));
    },
  };
}

module.exports = createStaysModel;
