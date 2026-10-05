// The hourly resources on the planning (specs/plugins-phase-3c-hourly-resources.md rules 14, 22): for
// a window of dates, the timed cards of each day — the ignition and session cards of the stays, and
// the bookings made outside a stay.
import { api } from '../sdk';

/** `{ [date]: [{ key, time, kind, item }] }` for [from, to], each list in no particular order. */
export async function loadResourceDays({ from, to }) {
  const [cards, bookings] = await Promise.all([
    api.getPlanningResourceCards({ from, to }),
    api.getResourceBookingPlanningEvents(from, to),
  ]);
  const out = {};
  const push = (date, entry) => { (out[date] = out[date] || []).push(entry); };
  Object.entries(cards?.resourceCardsByDate || {}).forEach(([date, day]) => {
    (day?.items || []).forEach((item) => {
      const ignition = item.kind === 'ignition';
      push(date, {
        key: `${ignition ? 'ign' : 'res'}-${item.reservationId}-${item.resourceId}-${item.start || ''}`,
        // An ignition card sits at the moment it must be lit; a session at its start.
        time: ignition ? item.time : item.start,
        kind: ignition ? 'ignition' : 'session',
        item,
      });
    });
  });
  (Array.isArray(bookings) ? bookings : []).forEach((booking) => {
    push(booking.date, { key: `rb-${booking.id}`, time: booking.startTime, kind: 'booking', item: booking });
  });
  return out;
}
