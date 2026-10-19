// specs/wp-booking-widget-redesign.md rules 29-31 (UI/UX review 2026-10-18, decision 2) — the chosen
// stay always reads as selected, past days and taken nights never look alike, and a window with
// nothing to pick says when the first free night is, from the server's `nextAvailableDate`.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);
const taken = nextMonthDays(20, 21).a;

function isoAdd(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayIso() { return isoAdd(new Date().toISOString().slice(0, 10), 0); }

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

test('rule 31: a past day is muted, a taken night is struck, and the legend names the states', async () => {
  bookingContainer();
  loadBlock('blocks/booking/view.js', { routes: catalogueRoutes(() => null, { blocked: [taken.iso] }) });
  await screen.findByRole('button', { name: days.a.label });
  const takenBtn = document.querySelector(`[data-gf-day="${taken.iso}"]`);
  expect(takenBtn.classList.contains('gf-taken')).toBe(true);
  expect(takenBtn.disabled).toBe(true);
  expect(takenBtn.getAttribute('aria-label')).toMatch(/indisponible$/);
  const past = document.querySelectorAll('button.gf-cal-day.gf-past');
  if (new Date().getDate() > 1) {
    expect(past.length).toBeGreaterThan(0);
    expect(past[0].classList.contains('gf-taken')).toBe(false);
    expect(past[0].getAttribute('aria-label')).not.toMatch(/indisponible/);
  }
  expect(document.querySelector('.gf-cal-legend').textContent).toBe('LibrePrisVotre séjour');
  // Nothing before this month to go back to.
  expect(screen.getByRole('button', { name: 'Mois précédent' }).disabled).toBe(true);
});

test('rule 29: the chosen edges are pressed, and the focused day keeps the focus after a re-render', async () => {
  bookingContainer();
  loadBlock('blocks/booking/view.js', { routes: catalogueRoutes() });
  await userEvent.click(await screen.findByRole('button', { name: days.a.label }));
  await waitFor(() => expect(document.activeElement && document.activeElement.dataset.gfDay).toBe(days.a.iso));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  await waitFor(() => expect(document.querySelectorAll('button.gf-cal-day.gf-edge')).toHaveLength(2));
  expect(document.activeElement.dataset.gfDay).toBe(days.b.iso);
  expect(screen.getByRole('button', { name: days.b.label }).getAttribute('aria-pressed')).toBe('true');
});

test('rule 30: two closed months → « Prochaine disponibilité » with the server date, and « Voir » goes there', async () => {
  const today = todayIso();
  const closed = [];
  for (let i = 0; i < 70; i++) closed.push(isoAdd(today, i));
  const next = isoAdd(today, 120);
  bookingContainer();
  const { calls } = loadBlock('blocks/booking/view.js', {
    routes: (method, p) => {
      if (p === '/properties/1/availability') return { status: 200, body: { data: { blockedDates: closed, nextAvailableDate: next } } };
      return catalogueRoutes()(method, p);
    },
  });
  const box = await screen.findByText(/^Prochaine disponibilité : /);
  const expected = new Date(`${next}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  expect(box.textContent).toBe(`Prochaine disponibilité : ${expected}`);
  // The pick-a-date prompt would contradict the box.
  expect(document.querySelector('.gf-cal-hint').textContent).toBe('');
  expect(calls.some((c) => c.path.startsWith('/properties/1/availability?from='))).toBe(true);

  await userEvent.click(screen.getByRole('button', { name: 'Voir' }));
  await waitFor(() => expect(document.querySelector(`[data-gf-day="${next}"]`)).toBeTruthy());
  expect(document.querySelector(`[data-gf-day="${next}"]`).disabled).toBe(false);
  await waitFor(() => expect(document.querySelector('.gf-cal-next').textContent).toBe(''));
});

test('rule 30: an older GuestFlow without the field shows no box, and the hint stays', async () => {
  const today = todayIso();
  const closed = [];
  for (let i = 0; i < 70; i++) closed.push(isoAdd(today, i));
  bookingContainer();
  loadBlock('blocks/booking/view.js', {
    routes: (method, p) => (p === '/properties/1/availability'
      ? { status: 200, body: { data: { blockedDates: closed } } }
      : catalogueRoutes()(method, p)),
  });
  await screen.findByText('Sélectionnez votre date d’arrivée', { selector: '.gf-cal-hint' });
  await new Promise((r) => setTimeout(r, 50));
  expect(document.querySelector('.gf-cal-next').textContent).toBe('');
});
