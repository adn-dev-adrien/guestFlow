import { MAX_STAY_NIGHTS, STAY_DATE_INVALID_MESSAGE, STAY_DATES_ORDER_MESSAGE, STAY_TOO_LONG_MESSAGE } from '../constants/stayDates';
import { dateWindowMessage } from './dateHorizon';
import { isRealIsoDay, localIsoToday } from './isoDay';

const DAY_MS = 86400000;

/**
 * The hint the fiche shows under its dates, '' when the two dates are typed and sound or not both typed
 * yet (specs/reservations-backend-mvc.md rule 12). It mirrors the server's guard (rule 11) so the fiche
 * neither quotes nor saves a stay the server refuses: a date that is not a real day (a 5-digit year), a departure on or before the arrival, or a stay
 * longer than MAX_STAY_NIGHTS, or a date outside the window of rule 13 (today ± 5 years). `stored` is the
 * record as loaded (`{ startDate, endDate }`): a date it already carries is not held to the window, as on the server.
 * `today` is the server's day when the page knows it (`useServerToday`), the device's otherwise.
 */
export function stayDatesMessage(startDate, endDate, { stored = null, today = localIsoToday() } = {}) {
  if (!startDate || !endDate) return '';
  if (!isRealIsoDay(startDate) || !isRealIsoDay(endDate)) return STAY_DATE_INVALID_MESSAGE;
  if (endDate <= startDate) return STAY_DATES_ORDER_MESSAGE;
  const nights = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS;
  if (nights > MAX_STAY_NIGHTS) return STAY_TOO_LONG_MESSAGE;
  const edited = (field, value) => !(stored && stored[field] === value);
  return (edited('startDate', startDate) && dateWindowMessage(startDate, today))
    || (edited('endDate', endDate) && dateWindowMessage(endDate, today)) || '';
}

/** Whether the stay is complete and sound enough to ask the server for a quote or its occupied dates. */
export function isQuotableStay(startDate, endDate, options) {
  return Boolean(startDate && endDate) && !stayDatesMessage(startDate, endDate, options);
}
