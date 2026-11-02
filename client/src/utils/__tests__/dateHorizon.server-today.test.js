// specs/reservations-backend-mvc.md rule 13, second reading (review of PR #938, F8) — the client hints judge the
// window from the server's Europe/Paris day when they know it, not from the device's date: on the boundary day a
// device ahead of Paris refused a save the server accepts, one behind sent what the server refuses.
import { stayDatesMessage, isQuotableStay } from '../stayDates';
import { customWindowError } from '../../components/PeriodSelector';
import { horizonStart, horizonEnd } from '../dateHorizon';
import { addIsoDays, localIsoToday } from '../isoDay';

const TOO_OLD = 'Date trop ancienne : 5 ans au plus.';
const TOO_FAR = 'Date trop lointaine : 5 ans au plus.';
const LOCAL = localIsoToday();
const AHEAD = addIsoDays(LOCAL, 1);
const BEHIND = addIsoDays(LOCAL, -1);

test('stayDatesMessage and isQuotableStay read the window from the given today', () => {
  const start = horizonStart(LOCAL);
  expect(stayDatesMessage(start, addIsoDays(start, 3))).toBe('');
  expect(stayDatesMessage(start, addIsoDays(start, 3), { today: AHEAD })).toBe(TOO_OLD);
  expect(isQuotableStay(start, addIsoDays(start, 3), { today: AHEAD })).toBe(false);
  const end = addIsoDays(horizonEnd(LOCAL), 1);
  expect(stayDatesMessage(addIsoDays(end, -3), end)).toBe(TOO_FAR);
  expect(stayDatesMessage(addIsoDays(end, -3), end, { today: AHEAD })).toBe('');
  expect(stayDatesMessage(start, addIsoDays(start, 3), { today: AHEAD, stored: { startDate: start } })).toBe('');
});

test('customWindowError reads the window from the given today', () => {
  const from = horizonStart(LOCAL);
  expect(customWindowError(from, addIsoDays(from, 30))).toBe('');
  expect(customWindowError(from, addIsoDays(from, 30), AHEAD)).toBe(TOO_OLD);
  const to = horizonEnd(LOCAL);
  expect(customWindowError(addIsoDays(to, -30), to, BEHIND)).toBe(TOO_FAR);
});
