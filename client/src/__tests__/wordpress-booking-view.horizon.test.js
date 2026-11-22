// specs/gift-voucher-campaigns.md rule 51 — the booking calendar stops where the server says the public may no longer book:
// the days past `horizonUntil` are closed, forward navigation stops at the horizon's month, and a row of month chips jumps
// straight to a month. The limit is the server's: nothing here adds months to today.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock } from './wordpressBookingFixtures';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Served by the "server": the last day of the month three months from now, whatever today is.
const now = new Date();
const horizon = new Date(now.getFullYear(), now.getMonth() + 4, 0);
const HORIZON = iso(horizon);

function openCalendar({ horizonUntil = HORIZON } = {}) {
  bookingContainer();
  return loadBlock('blocks/booking/view.js', {
    routes: catalogueRoutes((method, p) => (p === '/properties/1/availability'
      ? { status: 200, body: { data: { blockedDates: [], horizonUntil } } }
      : null)),
  });
}

const chips = () => within(screen.getByRole('group', { name: 'Aller à un mois' })).getAllByRole('button');
const titles = () => [...document.querySelectorAll('.gf-cal-title')].map((t) => t.textContent);

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

test('one chip per month from this one to the horizon\'s, the two panes pressed', async () => {
  openCalendar();
  await waitFor(() => expect(chips()).toHaveLength(4));
  expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'false']);
});

test('a chip jumps to its month, and the last position ends the panes on the horizon\'s month', async () => {
  openCalendar();
  await waitFor(() => expect(chips()).toHaveLength(4));
  await userEvent.click(chips()[3]);
  const last = new Date(now.getFullYear(), now.getMonth() + 3, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  await waitFor(() => expect(titles()[1]).toBe(last));
  expect(screen.getByRole('button', { name: 'Mois suivant' }).disabled).toBe(true);
  expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'true']);
});

test('the days past the horizon are closed like past days, the horizon day itself is open', async () => {
  openCalendar();
  await waitFor(() => expect(chips()).toHaveLength(4));
  await userEvent.click(chips()[3]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mois suivant' }).disabled).toBe(true));
  expect(document.querySelector(`[data-gf-day="${HORIZON}"]`).disabled).toBe(false);
  const after = new Date(horizon.getFullYear(), horizon.getMonth(), horizon.getDate() + 1);
  const closed = document.querySelector(`[data-gf-day="${iso(after)}"]`);
  if (closed) {
    expect(closed.disabled).toBe(true);
    expect(closed.classList.contains('gf-past')).toBe(true);
    expect(closed.getAttribute('aria-label')).not.toMatch(/indisponible/);
  }
});

test('the arrow stops at the same place the chips reach, and never asks the server for a window past the horizon', async () => {
  const { calls } = openCalendar();
  await waitFor(() => expect(chips()).toHaveLength(4));
  const next = screen.getByRole('button', { name: 'Mois suivant' });
  for (let i = 0; i < 5 && !next.disabled; i += 1) {
    await userEvent.click(next);
    await waitFor(() => expect(document.querySelector('.gf-cal-month')).toBeTruthy());
  }
  expect(next.disabled).toBe(true);
  expect(chips().map((c) => c.getAttribute('aria-pressed')).slice(-2)).toEqual(['true', 'true']);
  calls.filter((c) => c.path.startsWith('/properties/1/availability')).forEach((c) => {
    const to = /to=([\d-]+)/.exec(c.path)[1];
    const from = /from=([\d-]+)/.exec(c.path)[1];
    expect(from < HORIZON).toBe(true);
    expect(to <= iso(new Date(horizon.getFullYear(), horizon.getMonth(), horizon.getDate() + 62))).toBe(true);
  });
});

test('an older GuestFlow that sends no horizon draws no chips and bounds nothing', async () => {
  bookingContainer();
  loadBlock('blocks/booking/view.js', { routes: catalogueRoutes() });
  await screen.findByRole('button', { name: 'Mois suivant' });
  await waitFor(() => expect(document.querySelector('.gf-cal-month')).toBeTruthy());
  expect(document.querySelector('.gf-cal-chips').children).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Mois suivant' }).disabled).toBe(false);
});
