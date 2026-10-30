// specs/payment-link-lifecycle.md rule 30 (and specs/wordpress-plugin.md rule 34) — on the payment return
// page, a status `expired` (the link lapsed unpaid, none open) stops the polling and says what to do.
import { screen } from '@testing-library/react';
import { bookingContainer, catalogueRoutes, loadBlock } from './wordpressBookingFixtures';

function returnPage(answers) {
  window.history.pushState({}, '', '/la-granja/?gf_payment=22299&gf_token=tok');
  bookingContainer({ payOnline: true });
  let i = 0;
  const routes = catalogueRoutes((method, p) => {
    if (p === '/booking-requests/22299/status') {
      const data = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return { status: 200, body: { data } };
    }
    return null;
  });
  return loadBlock('blocks/booking/view.js', { routes });
}

const statusCalls = (calls) => calls.filter((c) => c.path.startsWith('/booking-requests/22299/status')).length;

afterEach(() => {
  document.body.innerHTML = '';
  delete window.GFBooking;
  window.history.pushState({}, '', '/');
  vi.useRealTimers();
});

test('rule 30: an expired link stops the polling and tells the guest to book again', async () => {
  vi.useFakeTimers();
  const { calls } = returnPage([{ status: 'expired' }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByText('Ce lien de paiement a expiré. Refaire la réservation depuis la page du logement.')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(30000);
  expect(statusCalls(calls)).toBe(1);
  expect(screen.queryByText('Confirmation de votre paiement en cours…')).toBeNull();
});

test('rule 30: a pending answer then expired ends on the expiry message', async () => {
  vi.useFakeTimers();
  const { calls } = returnPage([{ status: 'pending' }, { status: 'expired' }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByText('Confirmation de votre paiement en cours…')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(3000);
  expect(screen.getByText('Ce lien de paiement a expiré. Refaire la réservation depuis la page du logement.')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(30000);
  expect(statusCalls(calls)).toBe(2);
});

test('rule 30: a confirmed payment still wins over everything', async () => {
  vi.useFakeTimers();
  returnPage([{ status: 'confirmed', propertyName: 'La Granja', startDate: '2027-05-10', endDate: '2027-05-14', totalStayPrice: 455.36 }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByText('Paiement confirmé — votre réservation est validée !')).toBeTruthy();
  expect(screen.queryByText(/a expiré/)).toBeNull();
});
