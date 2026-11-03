// specs/reservations-backend-mvc.md rule 12, reading of 2026-11-03 (audit R20-C2) — a date that is not a real
// `YYYY-MM-DD` day (a 5- or 6-digit year typed on the keyboard, 30 February) gets the server's own « Date de séjour
// invalide. » under the dates and is never quoted. A year still being typed (0002, padded to four digits) is a
// real day: it gets the window's message (rule 14). A stored date is a real day, so the stored-row exemption holds.
import { stayDatesMessage, isQuotableStay } from '../stayDates';
import { STAY_DATE_INVALID_MESSAGE, STAY_DATES_ORDER_MESSAGE, STAY_TOO_LONG_MESSAGE } from '../../constants/stayDates';
import { horizonStart } from '../dateHorizon';
import { addIsoDays, localIsoToday } from '../isoDay';

const T = localIsoToday();
const ARRIVAL = addIsoDays(T, 30);
const DEPARTURE = addIsoDays(T, 33);
const fiveDigits = `3${DEPARTURE}`;
const sixDigits = `20${DEPARTURE}`;
const feb30 = `${Number(T.slice(0, 4)) + 1}-02-30`;

test('the message is the server\'s', () => {
  expect(STAY_DATE_INVALID_MESSAGE).toBe('Date de séjour invalide.');
});

test.each([
  ['a 5-digit departure year', ARRIVAL, fiveDigits],
  ['a 6-digit departure year', ARRIVAL, sixDigits],
  ['a 5-digit arrival year', `3${ARRIVAL}`, DEPARTURE],
  ['30 February', `${feb30.slice(0, 8)}20`, feb30],
])('%s is refused as an invalid day and not quotable', (_name, start, end) => {
  expect(stayDatesMessage(start, end, { today: T })).toBe(STAY_DATE_INVALID_MESSAGE);
  expect(isQuotableStay(start, end, { today: T })).toBe(false);
});

test('a half-typed year padded to four digits is a real day: the order or length message speaks, as before', () => {
  expect(stayDatesMessage(`0002${ARRIVAL.slice(4)}`, DEPARTURE, { today: T })).toBe(STAY_TOO_LONG_MESSAGE);
  expect(stayDatesMessage(ARRIVAL, `0002${DEPARTURE.slice(4)}`, { today: T })).toBe(STAY_DATES_ORDER_MESSAGE);
});

test('a stored stay outside the window still passes', () => {
  const start = addIsoDays(horizonStart(T), -40);
  const end = addIsoDays(start, 3);
  expect(stayDatesMessage(start, end, { stored: { startDate: start, endDate: end }, today: T })).toBe('');
  expect(isQuotableStay(start, end, { stored: { startDate: start, endDate: end }, today: T })).toBe(true);
});
