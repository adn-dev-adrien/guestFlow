/**
 * « À compléter » (specs/booking-extranet-intake.md rules 21–24): the Booking stays the iCal import created
 * and nobody filled yet. Read-only; computed on read, nothing stored but the operator's dismissals.
 */

const URGENT_DAYS = 7;
const EXTRANET = 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/search_reservations.html';

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// The Lodgify feed also carries Airbnb and direct stays: only a stay labelled Booking, or still the feed's
// own « Lodgify » placeholder, can be Booking's.
const canBeBooking = (platform) => /^(booking|lodgify|)$/.test(String(platform || '').trim().toLowerCase().replace(/\.com$/, ''));

const extranetUrl = (hotelId, date) => `${EXTRANET}?hotel_id=${encodeURIComponent(hotelId)}&date_type=arrival&date_from=${date}&date_to=${date}`;

// Rule 21, amended 2026-10-18 — which feeds can carry a Booking stay is read from the sources themselves,
// no longer from a setting: Booking's own feed always; the Lodgify relay only while it is active (a
// retired relay's leftover stays are not Booking's to fill — they were already filled, or never will be).
function listPending({ db, hotelIds, today }) {
  const propertyIds = Object.keys(hotelIds).filter((id) => String(hotelIds[id] || '').trim());
  if (propertyIds.length === 0) return [];
  const rows = db.prepare(`
    SELECT r.id, r.propertyId, r.startDate, r.endDate, r.platform, p.name AS propertyName
    FROM reservations r
    JOIN properties p ON p.id = r.propertyId
    JOIN ical_sources s ON s.id = r.sourceIcalSourceId
    WHERE r.kind = 'reservation' AND r.startDate >= ? AND r.sourceType = 'ical'
      AND (lower(s.platformKey) = 'booking' OR (lower(s.platformKey) = 'lodgify' AND s.isActive = 1))
      AND r.propertyId IN (${propertyIds.map(() => '?').join(',')})
      AND (r.platformGrossAmount IS NULL OR r.platformGrossAmount = '')
      AND r.id NOT IN (SELECT reservationId FROM booking_dismissals)
    ORDER BY r.startDate, r.id`).all(today, ...propertyIds.map(Number));
  return rows.filter((r) => canBeBooking(r.platform)).map((r) => {
    const days = dayDiff(today, r.startDate);
    return {
      reservationId: r.id,
      propertyName: r.propertyName,
      startDate: r.startDate,
      endDate: r.endDate,
      daysToArrival: days,
      urgent: days <= URGENT_DAYS,
      extranetUrl: extranetUrl(hotelIds[r.propertyId], r.startDate),
    };
  });
}

module.exports = { listPending, extranetUrl, URGENT_DAYS };
