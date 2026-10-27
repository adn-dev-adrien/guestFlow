// specs/wordpress-plugin.md rule 30 (2026-10-27 audit, plugin 1.17.1) — a quote whose stay breaks the
// maximum stay or the changeover days carries `stayRefusal`: the drawer prints GuestFlow's sentence,
// keeps no quote and leaves the request button disabled.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays, quote } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);
const REFUSAL = 'Arrivée le samedi uniquement sur cette période.';

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

async function pick(stayRefusal) {
  bookingContainer();
  const routes = catalogueRoutes((method, p) => (p === '/quote'
    ? { status: 200, body: { data: quote({ stayRefusal, changeoverBreached: Boolean(stayRefusal) }) } }
    : null));
  loadBlock('blocks/booking/view.js', { routes });
  await userEvent.click(await screen.findByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
}

const submit = () => document.querySelector('.gf-btn');

test('the refusal is printed in the summary and the request cannot be sent', async () => {
  await pick(REFUSAL);
  await waitFor(() => expect(document.querySelector('.gf-summary .gf-empty, .gf-empty')?.textContent).toBe(REFUSAL));
  expect(screen.getAllByText(REFUSAL).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(/Total/);
  expect(submit().disabled).toBe(true);
});

test('a quote without refusal is drawn as before', async () => {
  await pick(null);
  await waitFor(() => expect(document.body.textContent).not.toContain(REFUSAL));
  await waitFor(() => expect(document.querySelector('.gf-summary-dates')).toBeTruthy());
});
