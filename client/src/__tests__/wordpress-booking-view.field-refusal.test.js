// specs/wordpress-plugin.md rule 28 (UI/UX review 2026-10-18, decision 3) — every requirement is
// refused on its own field, in French: all marked at once, the first one focused, the reason under
// it, cleared live once corrected. The server's `details[].message` lands under the field it names,
// and `gf:refused` tells a host that moved the engine's children which field refused.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);

async function boot(extra = () => null) {
  bookingContainer();
  const ctx = loadBlock('blocks/booking/view.js', { routes: catalogueRoutes(extra) });
  await userEvent.click(await screen.findByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  await waitFor(() => expect(document.querySelector('.gf-btn').disabled).toBe(false), { timeout: 2000 });
  return ctx;
}

const errorOf = (label) => {
  const input = screen.getByLabelText(label);
  return { input, text: document.getElementById(input.getAttribute('aria-describedby')).textContent };
};

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

test('rule 28: missing fields are marked one by one, the first one gets the focus, nothing is sent', async () => {
  const { calls } = await boot();
  await userEvent.type(screen.getByLabelText('Prénom *'), 'Aleksandra');
  await userEvent.type(screen.getByLabelText('E-mail *'), 'jo@');
  await userEvent.click(document.querySelector('.gf-btn'));

  expect(errorOf('Nom *').text).toBe('Champ requis.');
  expect(errorOf('E-mail *').text).toBe('Adresse e-mail incomplète.');
  expect(errorOf('Téléphone *').text).toBe('Champ requis.');
  expect(errorOf('Prénom *').text).toBe('');
  expect(screen.getByLabelText('Nom *').getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(screen.getByLabelText('Nom *'));
  // The CGV box refuses in the same pass, where it sits.
  expect(screen.getByText('Acceptez d’abord les conditions générales de location.')).toBeTruthy();
  expect(screen.queryByText('Merci de renseigner tous les champs obligatoires.')).toBeNull();
  expect(calls.some((c) => c.path === '/booking-requests')).toBe(false);
});

test('rule 28: no red while typing before a refusal; live clearing after one', async () => {
  await boot();
  await userEvent.type(screen.getByLabelText('E-mail *'), 'jo@');
  expect(document.querySelectorAll('.gf-field.is-invalid')).toHaveLength(0);
  await userEvent.click(document.querySelector('.gf-btn'));
  await userEvent.type(screen.getByLabelText('Nom *'), 'Wiśniewska-Kowalczyk');
  expect(errorOf('Nom *').text).toBe('');
  expect(screen.getByLabelText('Nom *').getAttribute('aria-invalid')).toBe('false');
  await userEvent.type(screen.getByLabelText('E-mail *'), 'example.com');
  expect(errorOf('E-mail *').text).toBe('');
});

test('rule 28: the server refusal lands under the field it names, with the server sentence', async () => {
  await boot((method, p) => (p === '/booking-requests' ? {
    status: 422,
    body: { error: { code: 'VALIDATION_FAILED', message: 'Coordonnées incomplètes ou invalides.', details: [
      { field: 'guest.email', issue: 'must be a valid email', reason: 'emailInvalid', message: 'Adresse e-mail incomplète.' },
    ] } },
  } : null));
  await userEvent.type(screen.getByLabelText('Prénom *'), 'Jo');
  await userEvent.type(screen.getByLabelText('Nom *'), 'Martin');
  await userEvent.type(screen.getByLabelText('E-mail *'), 'jo@x');
  await userEvent.type(screen.getByLabelText('Téléphone *'), '0612345678');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(document.querySelector('.gf-btn'));

  await waitFor(() => expect(errorOf('E-mail *').text).toBe('Adresse e-mail incomplète.'));
  expect(document.activeElement).toBe(screen.getByLabelText('E-mail *'));
  // Said once, where it belongs — not repeated under the button.
  expect(screen.queryByText('Coordonnées incomplètes ou invalides.')).toBeNull();
});

test('rule 28: an older server without `message` still marks the field, with the plugin words', async () => {
  await boot((method, p) => (p === '/booking-requests' ? {
    status: 422,
    body: { error: { code: 'VALIDATION_FAILED', message: 'Coordonnées du client invalides.', details: [{ field: 'guest.email', issue: 'must be a valid email' }] } },
  } : null));
  await userEvent.type(screen.getByLabelText('Prénom *'), 'Jo');
  await userEvent.type(screen.getByLabelText('Nom *'), 'Martin');
  await userEvent.type(screen.getByLabelText('E-mail *'), 'jo@x');
  await userEvent.type(screen.getByLabelText('Téléphone *'), '0612345678');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(document.querySelector('.gf-btn'));
  await waitFor(() => expect(errorOf('E-mail *').text).toBe('Adresse e-mail incomplète.'));
});

test('rule 28: phone and e-mail open the right keyboard and autofill', async () => {
  await boot();
  expect(screen.getByLabelText('Téléphone *').getAttribute('inputmode')).toBe('tel');
  expect(screen.getByLabelText('E-mail *').getAttribute('autocomplete')).toBe('email');
  expect(screen.getByLabelText('Prénom *').getAttribute('autocomplete')).toBe('given-name');
});

test('rule 28: the refusal is announced as `gf:refused` with the first field, before the engine reveals it', async () => {
  await boot();
  const seen = [];
  document.addEventListener('gf:refused', (ev) => seen.push(ev.detail));
  await userEvent.type(screen.getByLabelText('Prénom *'), 'Jo');
  await userEvent.click(document.querySelector('.gf-btn'));
  expect(seen).toHaveLength(1);
  expect(seen[0].field).toBe('lastName');
  expect(seen[0].element).toBe(screen.getByLabelText('Nom *'));
  expect(document.activeElement).toBe(screen.getByLabelText('Nom *'));
});

test('rule 28: a host that takes the refusal over (preventDefault) moves the focus itself', async () => {
  await boot();
  const host = (ev) => ev.preventDefault();
  document.addEventListener('gf:refused', host);
  await userEvent.click(document.querySelector('.gf-btn'));
  document.removeEventListener('gf:refused', host);
  // The focus stays on the button the visitor pressed: the field is the host's to reveal.
  expect(document.activeElement).toBe(document.querySelector('.gf-btn'));
  // The marks are still there: only the reveal is the host's.
  expect(errorOf('Prénom *').text).toBe('Champ requis.');
});

test('rule 28: one error line is described by its field, not a live region of its own', async () => {
  await boot();
  await userEvent.click(document.querySelector('.gf-btn'));
  const line = document.getElementById(screen.getByLabelText('Nom *').getAttribute('aria-describedby'));
  expect(line.getAttribute('aria-live')).toBeNull();
});
