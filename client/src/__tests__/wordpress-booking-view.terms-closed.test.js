// specs/wordpress-plugin.md rule 21 — no CGV published while GuestFlow requires them: the booking
// block says « Réservation en ligne fermée pour le moment. » instead of a form every request of which
// would be refused at the end. Rule 18: a website booking switched off in GuestFlow reads as the
// « unavailable » state, not as a generic failure.
import { screen } from '@testing-library/react';
import { bookingContainer, catalogueRoutes, loadBlock } from './wordpressBookingFixtures';

const notConfigured = (bookingClosed) => ({
  status: 503,
  body: { error: { code: 'TERMS_NOT_CONFIGURED', message: 'x', details: [{ bookingClosed }] } },
});

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

test('rule 21: enforcement on and nothing published → the form is replaced', async () => {
  bookingContainer();
  loadBlock('blocks/booking/view.js', { routes: catalogueRoutes(() => null, { terms: notConfigured(true) }) });
  expect(await screen.findByText('Réservation en ligne fermée pour le moment.')).toBeTruthy();
  expect(document.querySelector('.gf-btn')).toBeNull();
});

test('rule 21: enforcement off → the form, without a CGV box', async () => {
  bookingContainer();
  loadBlock('blocks/booking/view.js', { routes: catalogueRoutes(() => null, { terms: notConfigured(false) }) });
  expect(await screen.findByText('La Granja')).toBeTruthy();
  expect(document.querySelector('.gf-btn')).toBeTruthy();
  expect(document.querySelector('.gf-cgv-accept')).toBeNull();
});

test('rule 18: {"error":"PLUGIN_INACTIVE"} → « Réservation temporairement indisponible. »', async () => {
  bookingContainer();
  const off = { status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'website-booking' } };
  loadBlock('blocks/booking/view.js', { routes: () => off });
  expect(await screen.findByText('Réservation temporairement indisponible.')).toBeTruthy();
  expect(window.GFBooking.errorMessage({ status: 500, body: { error: { code: 'X', message: 'Précis.' } } })).toBe('Précis.');
});
