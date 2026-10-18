/**
 * Upcoming arrivals — the ids behind « Réservations à venir » (specs/upcoming-reservations-cards.md
 * rule 6). Every reservation arriving on `today` or later, in arrival order: day, then check-in time
 * (an unset time last), then id. Devis and cancelled stays are not arrivals.
 */

const db = require('../database');

function createUpcomingReservationsModel(database) {
  return {
    arrivalIdsFrom(today) {
      return database.prepare(`
        SELECT r.id
        FROM reservations r
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE r.kind = 'reservation' AND r.startDate >= ?
        ORDER BY r.startDate, COALESCE(NULLIF(r.checkInTime, ''), '23:59'), r.id
      `).all(today).map((row) => row.id);
    },
  };
}

const defaultModel = createUpcomingReservationsModel(db);
defaultModel.create = createUpcomingReservationsModel;
module.exports = defaultModel;
