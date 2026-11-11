// Shared by the PlanningPage suites: what GET /api/planning/days answers, built the way the server does
// (every calendar day of the window, empty ones included), so each suite only states the cards it cares about.
import { vi } from 'vitest';
import { addIsoDays } from '../../utils/isoDay';

const SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export const SERVER_TODAY = '2026-10-25';

export function day(date, today, cards = {}) {
  const at = new Date(`${date}T00:00:00Z`);
  return {
    date,
    label: LONG.format(at),
    shortLabel: SHORT.format(at),
    isToday: date === today,
    isPast: date < today,
    arrivals: [],
    departures: [],
    breakfast: null,
    optionCards: null,
    ...cards,
  };
}

/** `cardsByDate`: `{ [date]: { arrivals, departures, breakfast, optionCards } }`; `alerts` as the server sends them. */
export function daysPayload({ from, to }, { today = SERVER_TODAY, cardsByDate = {}, alerts = {} } = {}) {
  const days = [];
  for (let date = from; date <= to; date = addIsoDays(date, 1)) days.push(day(date, today, cardsByDate[date]));
  return { from, to, today, days, alerts: { arrivals: {}, departures: {}, ...alerts } };
}

export const stay = (id, extra = {}) => ({
  id, propertyId: 1, propertyName: 'Gîte', firstName: 'Camille', lastName: `Client${id}`,
  startDate: '2026-10-25', endDate: '2026-10-28', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, ...extra,
});

/** jsdom does not scroll: record the calls instead of logging « not implemented ». */
export function stubWindowScroll() {
  const scrollTo = vi.fn();
  window.scrollTo = scrollTo;
  return scrollTo;
}
