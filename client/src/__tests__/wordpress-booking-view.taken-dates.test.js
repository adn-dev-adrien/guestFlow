// specs/wordpress-plugin.md rule 36 (2026-11-12) — dates the quote answers `available: false` (a link's dates, or
// nights booked since the calendar loaded) are refused IN THE CALENDAR, like a minimum-stay breach: the Solio drawer
// gates its « Suivant » on that hint. No price is shown, no send is possible, and the calendar reloads its nights.
// A quote refused with a 409 (times the neighbours cannot take) reads in the calendar too.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays, quote } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);
const RANGE_BLOCKED = 'Ces dates incluent une nuit indisponible. Choisissez une autre période.';
const TAKEN = 'Ces dates ne sont plus disponibles.';

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

const calendarError = () => document.querySelector('.gf-cal-hint-error');
const sendButtons = () => [...document.querySelectorAll('.gf-btn, .gf-summary-cta')];

async function pickWith(quoteAnswer, { blockedAfterRefusal = [] } = {}) {
  bookingContainer({ payOnline: true });
  let refused = false;
  const routes = catalogueRoutes((method, p) => {
    if (p === '/quote') { refused = true; return quoteAnswer; }
    if (p === '/properties/1/availability' && refused) return { status: 200, body: { data: { blockedDates: blockedAfterRefusal } } };
    return null;
  });
  const { calls } = loadBlock('blocks/booking/view.js', { routes });
  await userEvent.click(await screen.findByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  return calls;
}

test('taken dates: refused in the calendar, no price, nothing can be sent', async () => {
  await pickWith({ status: 200, body: { data: quote({ available: false }) } });
  await waitFor(() => expect(calendarError()?.textContent).toBe(RANGE_BLOCKED));
  expect(document.querySelector('.gf-summary .gf-empty, .gf-empty')?.textContent).toBe(TAKEN);
  expect(document.querySelector('.gf-summary-total')).toBeNull();
  expect(document.body.textContent).not.toMatch(/310/);
  expect(document.querySelector('.gf-inline-warn')).toBeNull();
  sendButtons().forEach((b) => expect(b.disabled).toBe(true));
  // The period stays on screen: the visitor sees what was refused.
  expect(document.querySelector(`[data-gf-day="${days.a.iso}"]`).classList.contains('gf-edge')).toBe(true);
});

test('taken dates: the calendar reloads its nights from GuestFlow and shows them taken', async () => {
  const calls = await pickWith({ status: 200, body: { data: quote({ available: false }) } }, { blockedAfterRefusal: [days.a.iso] });
  await waitFor(() => expect(document.querySelector(`[data-gf-day="${days.a.iso}"]`).classList.contains('gf-taken')).toBe(true));
  const reads = calls.filter((c) => c.path.startsWith('/properties/1/availability'));
  expect(reads.length).toBeGreaterThan(1);
});

test('a 409 on the stay (times the neighbours cannot take) reads in the calendar', async () => {
  const sentence = 'Ces horaires ne sont pas disponibles avec les séjours voisins.';
  await pickWith({ status: 409, body: { error: { code: 'STAY_TIMES_UNAVAILABLE', message: sentence } } });
  await waitFor(() => expect(calendarError()?.textContent).toBe(sentence));
  sendButtons().forEach((b) => expect(b.disabled).toBe(true));
});

test('an available quote is drawn as before, with no calendar refusal', async () => {
  await pickWith({ status: 200, body: { data: quote() } });
  await waitFor(() => expect(document.querySelector('.gf-summary-total')).toBeTruthy());
  expect(calendarError()).toBeNull();
  expect(document.querySelector('.gf-btn').disabled).toBe(false);
});
