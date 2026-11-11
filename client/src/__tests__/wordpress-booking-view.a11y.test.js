// specs/wordpress-plugin.md rule 15 — the booking engine of the WordPress plugin is usable with a
// screen reader: every field is named by its label, each stepper button says what it counts, a
// calendar day reads in full with its state, and the quote, hints and refusals are live regions.
// Also rule 22 (real plurals in the recap) and rule 23 (the e-mail field's own row).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays, quote } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);
const taken = nextMonthDays(20, 21).a;

async function boot(routes = catalogueRoutes(() => null, { blocked: [taken.iso] })) {
  bookingContainer();
  const ctx = loadBlock('blocks/booking/view.js', { routes });
  await screen.findByText('La Granja');
  await screen.findByRole('button', { name: days.a.label });
  return ctx;
}

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

test('rule 15: every visible field is named by its label', async () => {
  await boot();
  for (const name of ['Arrivée', 'Départ', 'Heure d’arrivée', 'Heure de départ', 'Prénom *', 'Nom *', 'E-mail *', 'Téléphone *', 'Message']) {
    expect(screen.getByLabelText(name)).toBeTruthy();
  }
  expect(screen.getByLabelText('E-mail *').getAttribute('aria-required')).toBe('true');
});

test('rule 15: the stepper buttons say what they count', async () => {
  await boot();
  const adults = screen.getByRole('group', { name: 'Adultes' });
  expect(within(adults).getByRole('button', { name: 'Ajouter : Adultes' })).toBeTruthy();
  expect(within(adults).getByRole('button', { name: 'Retirer : Adultes' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ajouter : Petit déjeuner' })).toBeTruthy();
  await userEvent.click(within(adults).getByRole('button', { name: 'Ajouter : Adultes' }));
  expect(within(adults).getByText('3').getAttribute('aria-live')).toBe('polite');
});

test('rule 15: a day reads in full, a taken one says so, the chosen edges are pressed', async () => {
  await boot();
  const takenDay = screen.getByRole('button', { name: `${taken.label}, indisponible` });
  expect(takenDay.disabled).toBe(true);

  const arrival = screen.getByRole('button', { name: days.a.label });
  expect(arrival.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(arrival);
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  await waitFor(() => expect(screen.getByRole('button', { name: days.a.label }).getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByRole('button', { name: days.b.label }).getAttribute('aria-pressed')).toBe('true');
  // The weekday headings are decoration once every day carries its full name.
  document.querySelectorAll('.gf-cal-dow').forEach((d) => expect(d.getAttribute('aria-hidden')).toBe('true'));
});

test('rule 15: the hint, the quote and the feedback are live regions', async () => {
  await boot();
  expect(document.querySelector('.gf-cal-hint').getAttribute('aria-live')).toBe('polite');
  expect(document.querySelector('.gf-summary').getAttribute('aria-live')).toBe('polite');
  expect(screen.getByRole('status').textContent).toMatch('Sélectionnez votre date d’arrivée');
});

test('rule 22: « 1 nuit », « 3 nuits » — never « nuit(s) »', async () => {
  let nights = 1;
  const routes = catalogueRoutes((method, p) => (p === '/quote' ? { status: 200, body: { data: quote({ nights }) } } : null));
  await boot(routes);
  await userEvent.click(screen.getByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  expect(await screen.findByText('1 nuit', {}, { timeout: 2000 })).toBeTruthy();
  nights = 3;
  await userEvent.click(screen.getByRole('button', { name: nextMonthDays(10, 14).b.label }));
  expect(await screen.findByText('3 nuits', {}, { timeout: 2000 })).toBeTruthy();
  expect(document.body.textContent).not.toMatch('nuit(s)');
});

test('rule 23: the e-mail field carries the class that gives it a row of its own', async () => {
  await boot();
  expect(screen.getByLabelText('E-mail *').closest('.gf-field').classList.contains('gf-field-email')).toBe(true);
});
