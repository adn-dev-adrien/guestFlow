/**
 * The reservation fields a guest session may read (specs/guest-app.md rule 8). The SELECT is the
 * minimisation: no e-mail, phone, address or amount ever enters the plugin's session path. A row of any
 * `kind` is returned: `currentStay.js` decides what is live.
 */

const COLUMNS = `
  r.id, r.kind, r.propertyId, r.reservationNumber, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
  r.adults, r.teens, r.children, r.babies,
  c.firstName AS clientFirstName, c.lastName AS clientLastName, c.emailLanguage AS clientLanguage
`;

function createStaysModel(db) {
  return {
    byId(id) {
      return db.prepare(`SELECT ${COLUMNS} FROM reservations r LEFT JOIN clients c ON c.id = r.clientId WHERE r.id = ?`)
        .get(Number(id)) || null;
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
