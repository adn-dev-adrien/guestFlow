/**
 * Booking.com feed — echo classification (specs/lodgify-decommission.md §3 rules 6-8).
 *
 * An incoming Booking event is compared, night by night, with the ranges GuestFlow already holds
 * (other reservations, closures, recent tombstones). The closure guard still drops a closure's own echo
 * on 'echo'; for stays and tombstones every covered night is a conflict (rule 6, amended 2026-10-28):
 *   - every night covered  → 'echo'    (wholly held: a closure's own echo, or a stay sold twice)
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
