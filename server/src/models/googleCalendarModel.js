// Google Calendar model — reads the reservations (kind='reservation' only) + their options to push to
// Google. A devis is never synced.

const db = require('../database');

function createGoogleCalendarModel(database) {
  return {
    listReservationsForSync() {
      const reservations = database.prepare(`
        SELECT
          r.id, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
          r.adults, r.children, r.teens, r.babies, r.singleBeds, r.doubleBeds, r.babyBeds,
          p.name AS propertyName,
          c.lastName AS clientLastName,
          c.firstName AS clientFirstName
        FROM reservations r
        JOIN properties p ON p.id = r.propertyId
        JOIN clients c ON c.id = r.clientId
        WHERE r.kind = 'reservation'
        ORDER BY r.startDate ASC, r.id ASC
      `).all();

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

      return reservations.map((r) => ({ ...r, options: optionsByReservation.get(Number(r.id)) || [] }));
    },
  };
}

const defaultModel = createGoogleCalendarModel(db);
defaultModel.buildModel = createGoogleCalendarModel;

module.exports = defaultModel;
