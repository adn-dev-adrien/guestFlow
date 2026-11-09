/**
 * resourceBookingDraft — the price-relevant part of the booking dialog, as the server prices it
 * (specs/resource-supplements-total-server-side.md rule 9).
 *
 * Pure. The offered minutes are in it (specs/resource-booking-pricing-and-invoicing.md rule 7); the client's name, phone, notes and payment are NOT, so typing them sends no request.
 * Returns `null` while the range is incomplete or not chronological: nothing to price yet.
 */
export default function resourceBookingDraft({
  resourceId, bookingId, date, startTime, endTime, propertyId, offeredMinutes = 0,
}) {
  if (!resourceId || !date || !startTime || !endTime || endTime <= startTime) return null;
  return {
    resourceId: Number(resourceId),
    bookingId: bookingId ? Number(bookingId) : null,
    date,
    startTime,
    endTime,
    propertyId: propertyId ? Number(propertyId) : null,
    offeredMinutes: Number(offeredMinutes) || 0,
  };
}
