// specs/wordpress-plugin.md rules 16, 25 and 27 — with online payment on, a payment that fails leaves one
// request, and trying again pays for that same devis instead of creating another. Also
// specs/public-online-payment.md rule 12: while GuestFlow says no payment provider is connected
// (`payment.onlineReady: false`), the button sends a plain request.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays, quote } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);

const CREATED = { status: 201, body: { data: { requestId: 22299, publicToken: 'tok', reference: '2026-10-003' } } };
const PAY_FAILS = { status: 502, body: { error: { code: 'QONTO_API_ERROR', message: 'Erreur du fournisseur de paiement.' } } };

async function bootAndFill({ onlineReady = true } = {}) {
  bookingContainer({ payOnline: true });
  const routes = catalogueRoutes((method, p) => {
    if (p === '/quote') return { status: 200, body: { data: quote({ payment: { mode: 'full', onlineReady } }) } };
    if (p === '/booking-requests') return CREATED;
    if (p === '/booking-requests/22299/pay') return PAY_FAILS;
    return null;
  });
  const ctx = loadBlock('blocks/booking/view.js', { routes });
  await userEvent.click(await screen.findByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  await userEvent.type(screen.getByLabelText('Prénom *'), 'Jean-Pierre');
  await userEvent.type(screen.getByLabelText('Nom *'), 'Le Goff');
  await userEvent.type(screen.getByLabelText('E-mail *'), 'jp@example.com');
  await userEvent.type(screen.getByLabelText('Téléphone *'), '0600000000');
  await userEvent.click(screen.getByRole('checkbox'));
  return ctx;
}

const submit = () => document.querySelector('.gf-btn');
const count = (calls, p) => calls.filter((c) => c.method === 'POST' && c.path === p).length;

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

test('rule 16: a retried payment pays for the same devis — one booking request in all', async () => {
  const { calls } = await bootAndFill();
  await waitFor(() => expect(submit().disabled).toBe(false), { timeout: 2000 });
  expect(submit().textContent).toBe('Payer en ligne');

  await userEvent.click(submit());
  expect(await screen.findByText('Erreur du fournisseur de paiement.')).toBeTruthy();
  expect(screen.getByText('Demande enregistrée (référence 2026-10-003). Le paiement peut être relancé.')).toBeTruthy();
  expect(count(calls, '/booking-requests')).toBe(1);
  expect(count(calls, '/booking-requests/22299/pay')).toBe(1);

  await waitFor(() => expect(submit().disabled).toBe(false));
  await userEvent.click(submit());
  await waitFor(() => expect(count(calls, '/booking-requests/22299/pay')).toBe(2));
  expect(count(calls, '/booking-requests')).toBe(1);
  // One message at a time: the retry's error replaces the first one.
  expect(screen.getAllByText('Erreur du fournisseur de paiement.')).toHaveLength(1);
});

test('rule 27: a message corrected after the failure keeps the same devis', async () => {
  const { calls } = await bootAndFill();
  await waitFor(() => expect(submit().disabled).toBe(false), { timeout: 2000 });
  await userEvent.click(submit());
  await screen.findByText('Erreur du fournisseur de paiement.');
  await userEvent.type(screen.getByLabelText('Message'), 'Arrivée tardive');
  await waitFor(() => expect(submit().disabled).toBe(false));
  await userEvent.click(submit());
  await waitFor(() => expect(count(calls, '/booking-requests/22299/pay')).toBe(2));
  expect(count(calls, '/booking-requests')).toBe(1);
});

test('rule 16: a stay changed after the failure is a new request', async () => {
  const { calls } = await bootAndFill();
  await waitFor(() => expect(submit().disabled).toBe(false), { timeout: 2000 });
  await userEvent.click(submit());
  await screen.findByText('Erreur du fournisseur de paiement.');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter : Adultes' }));
  await waitFor(() => expect(submit().disabled).toBe(false));
  await userEvent.click(submit());
  await waitFor(() => expect(count(calls, '/booking-requests')).toBe(2));
});

test('rule 25: the payment return address names the lodging', async () => {
  const { calls } = await bootAndFill();
  await waitFor(() => expect(submit().disabled).toBe(false), { timeout: 2000 });
  await userEvent.click(submit());
  await screen.findByText('Erreur du fournisseur de paiement.');
  const pay = calls.find((c) => c.path === '/booking-requests/22299/pay');
  expect(pay.body.returnPath).toMatch(/\?property=1&gf_payment=22299&gf_token=tok$/);
});

test('public-online-payment rule 12: no provider connected → a plain request, no payment call', async () => {
  const { calls } = await bootAndFill({ onlineReady: false });
  await waitFor(() => expect(submit().disabled).toBe(false), { timeout: 2000 });
  expect(submit().textContent).toBe('Envoyer la demande');
  await userEvent.click(submit());
  expect(await screen.findByText(/Demande envoyée ! Référence : 2026-10-003/)).toBeTruthy();
  expect(calls.some((c) => /\/pay$/.test(c.path))).toBe(false);
});
