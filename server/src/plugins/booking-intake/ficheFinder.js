/**
 * The fiches a Booking page can belong to (specs/booking-extranet-intake.md rules 13 and 33): the property's
 * reservations on exactly the page's dates, never a cancelled one, and only those the iCal import could have
 * created for Booking — the same canal set as the « À compléter » list (`pendingFiches`): Booking, or the
 * Lodgify feed it came through, or no canal at all.
 */

const findFiches = (db) => ({ propertyId, startDate, endDate }) => db.prepare(`
  SELECT id FROM reservations
  WHERE kind = 'reservation' AND cancelledAt IS NULL AND propertyId = ? AND startDate = ? AND endDate = ?
    AND lower(trim(COALESCE(platform, ''))) IN ('', 'booking', 'booking.com', 'lodgify')`).all(propertyId, startDate, endDate);

module.exports = { findFiches };
