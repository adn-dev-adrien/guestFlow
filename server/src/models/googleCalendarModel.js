// Google Calendar model — reads the reservations (kind='reservation' only) + their options to push to
// Google. A devis is never synced. `propertyId` feeds the deterministic per-property event color.

const db = require('../database');

const RESERVATION_SELECT = `
  SELECT
    r.id, r.propertyId, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
    r.adults, r.children, r.teens, r.babies, r.singleBeds, r.doubleBeds, r.babyBeds,
    p.name AS propertyName,
    c.lastName AS clientLastName,
    c.firstName AS clientFirstName
  FROM reservations r
  JOIN properties p ON p.id = r.propertyId
  JOIN clients c ON c.id = r.clientId
  WHERE r.kind = 'reservation'
`;

function createGoogleCalendarModel(database) {
  function optionsForReservationIds() {
    const optionRows = database.prepare(`
      SELECT ro.reservationId, o.title, ro.quantity
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
      ORDER BY ro.reservationId ASC, o.title ASC
    `).all();

    const optionsByReservation = new Map();
    for (const row of optionRows) {
      const key = Number(row.reservationId);
      if (!optionsByReservation.has(key)) optionsByReservation.set(key, []);
      optionsByReservation.get(key).push({
        title: String(row.title || 'Option').trim(),
        quantity: Number(row.quantity || 0),
      });
    }
    return optionsByReservation;
  }

  return {
    listReservationsForSync() {
      const reservations = database.prepare(
        `${RESERVATION_SELECT} ORDER BY r.startDate ASC, r.id ASC`
      ).all();

      const optionsByReservation = optionsForReservationIds();
      return reservations.map((r) => ({ ...r, options: optionsByReservation.get(Number(r.id)) || [] }));
    },

    // Single-reservation read for targeted pushes. Returns null when the row is absent or a
    // devis — the caller then treats the push as a no-op.
    getReservationForSync(reservationId) {
      const reservation = database.prepare(
        `${RESERVATION_SELECT} AND r.id = ?`
      ).get(Number(reservationId));
      if (!reservation) return null;

      const options = database.prepare(`
        SELECT o.title, ro.quantity
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        WHERE ro.reservationId = ?
        ORDER BY o.title ASC
      `).all(Number(reservationId)).map((row) => ({
        title: String(row.title || 'Option').trim(),
        quantity: Number(row.quantity || 0),
      }));

      return { ...reservation, options };
    },
  };
}

const defaultModel = createGoogleCalendarModel(db);
defaultModel.buildModel = createGoogleCalendarModel;

module.exports = defaultModel;
