/**
 * Booking.com feed — echo classification (specs/lodgify-decommission.md §3 rules 6-8).
 *
 * Booking's iCal export labels every taken night « CLOSED - Not available », including the nights it
 * imported from GuestFlow's own export. An incoming Booking event is therefore compared, night by
 * night, with the ranges GuestFlow already holds (other reservations, closures, recent tombstones):
 *   - every night covered  → 'echo'    (Booking is only mirroring GuestFlow)
 *   - some nights covered  → 'partial' (merged adjacent stays, or a real overbooking)
 *   - no night covered     → 'free'    (a genuine Booking reservation)
 *
 * All ranges use the reservation convention: startDate inclusive, endDate exclusive (ISO dates).
 */
const { addIsoDays } = require('./icalParser');

function nightsOf(startDate, endDate) {
  const nights = [];
  for (let d = String(startDate); d < String(endDate); d = addIsoDays(d, 1)) nights.push(d);
  return nights;
}

function classifyBookingEvent(event, coveringRanges) {
  const nights = nightsOf(event.startDate, event.endDate);
  if (nights.length === 0) return 'free';
  const covered = nights.filter((night) => (coveringRanges || []).some(
    (range) => String(range.startDate) <= night && night < String(range.endDate),
  )).length;
  if (covered === nights.length) return 'echo';
  return covered === 0 ? 'free' : 'partial';
}

module.exports = { classifyBookingEvent };
