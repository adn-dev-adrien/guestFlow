// Google Calendar model — reads the reservations (kind='reservation' only) + their options to push to
// Google. A devis is never synced. `propertyId` feeds the deterministic per-property event color.

const { optionDisplayCount } = require('./events');

const OPTION_LINE_COLUMNS = `o.title, ro.quantity, ro.billedUnits, ro.priceType, r.startDate, r.endDate,
  COALESCE(o.showsPlanningCard, 0) AS isCard, COALESCE(o.isCancellationInsurance, 0) AS isInsurance`;

const toEventOption = (row) => ({
  title: String(row.title || 'Option').trim(),
  quantity: Number(row.quantity || 0),
  displayCount: optionDisplayCount(row),
});

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
      SELECT ro.reservationId, ${OPTION_LINE_COLUMNS}
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
      JOIN reservations r ON r.id = ro.reservationId
      ORDER BY ro.reservationId ASC, o.title ASC
    `).all();

    const optionsByReservation = new Map();
    for (const row of optionRows) {
      const key = Number(row.reservationId);
      if (!optionsByReservation.has(key)) optionsByReservation.set(key, []);
      optionsByReservation.get(key).push(toEventOption(row));
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
        SELECT ${OPTION_LINE_COLUMNS}
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        JOIN reservations r ON r.id = ro.reservationId
        WHERE ro.reservationId = ?
        ORDER BY o.title ASC
      `).all(Number(reservationId)).map(toEventOption);

      return { ...reservation, options };
    },
  };
}

module.exports = { buildModel: createGoogleCalendarModel };
