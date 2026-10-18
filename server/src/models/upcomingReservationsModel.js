/**
 * Upcoming arrivals — the ids behind « Réservations à venir » (specs/upcoming-reservations-cards.md
 * rule 6). Every reservation arriving on `today` or later, in arrival order: day, then check-in time
 * (an unset time last), then id. Devis and cancelled stays are not arrivals.
 */

const db = require('../database');

function arrivalIds(database, dateClause, value) {
  return database.prepare(`
    SELECT r.id
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE r.kind = 'reservation' AND r.startDate ${dateClause} ?
    ORDER BY r.startDate, COALESCE(NULLIF(r.checkInTime, ''), '23:59'), r.id
  `).all(value).map((row) => row.id);
}

function createUpcomingReservationsModel(database) {
  return {
    arrivalIdsFrom(today) {
      return arrivalIds(database, '>=', today);
    },
    /** One day's arrivals, same order (rule 8: the refresh after a « prêt » toggle). */
    arrivalIdsOn(day) {
      return arrivalIds(database, '=', day);
    },
  };
}

const defaultModel = createUpcomingReservationsModel(db);
defaultModel.create = createUpcomingReservationsModel;
module.exports = defaultModel;
