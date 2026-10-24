/**
 * resourceBookingDraft — the price-relevant part of the booking dialog, as the server prices it
 * (specs/resource-supplements-total-server-side.md rule 9).
 *
 * Pure. The client's name, phone, notes and « Payé » are NOT in it, so typing them sends no request.
 * Returns `null` while the range is incomplete or not chronological: nothing to price yet.
 */
export default function resourceBookingDraft({
  resourceId, bookingId, date, startTime, endTime, propertyId,
}) {
  if (!resourceId || !date || !startTime || !endTime || endTime <= startTime) return null;
  return {
    resourceId: Number(resourceId),
    bookingId: bookingId ? Number(bookingId) : null,
    date,
    startTime,
    endTime,
    propertyId: propertyId ? Number(propertyId) : null,
  };
}
