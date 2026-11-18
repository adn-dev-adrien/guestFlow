// specs/outside-booking-sas.md rule 54 (reading 2026-11-16, loop t3 UI3-4, UI3-5) — at « Payé maintenant » the arrival reads the server's answer for
// the payment typed: a failed answer shows « Facture non vérifiée pour ce paiement. » with « Réessayer » (the commit waits for it, never silently);
// « Caisse interne » is the server's `INTERNAL_CASH`, and any other refusal prints the server's reason.
// Reading 2026-11-16 (loop t4 UI4-3): the payment request carries the draft, so a refusal or failure of the draft itself is shown once.
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { visitPayload, fakeQuote } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const quote = fakeQuote();
const answering = (invoiceable) => async (id, body) => ({ ...(await quote(id, body)), ...(body.payment ? { invoiceable } : {}) });
const openDialog = () => render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  api.getResourceVisit.mockResolvedValue(visitPayload());
});

test('UI3-4 — a failed answer for the payment typed is shown with « Réessayer », and the arrival waits for it', async () => {
  let fail = true;
  api.quoteResourceVisit.mockImplementation(async (id, body) => {
    if (body.payment && fail) throw Object.assign(new Error('Service indisponible'), { status: 503 });
    return answering({ ok: true, code: null, reason: null })(id, body);
  });
  openDialog();
  expect(await screen.findByText('Facture non vérifiée pour ce paiement.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeDisabled();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeEnabled());
});

test('UI3-5 — « Caisse interne » is the server\'s INTERNAL_CASH, whatever the tenders typed', async () => {
  api.quoteResourceVisit.mockImplementation(answering({ ok: false, code: 'INTERNAL_CASH', reason: 'Caisse interne : hors comptabilité.', silent: false }));
  openDialog();
  expect(await screen.findByText(/^Caisse interne : hors comptabilité, pas de facture/)).toBeInTheDocument();
  expect(screen.queryByText('Créer la facture dans Qonto')).toBeNull();
});

test('UI3-5 — another refusal for the payment typed prints the server\'s reason, never « une fois le paiement saisi »', async () => {
  api.quoteResourceVisit.mockImplementation(answering({ ok: false, code: 'TARIFF_CHANGED', reason: 'Le tarif a changé : facture à établir dans Qonto.', silent: false }));
  openDialog();
  expect(await screen.findByText('Le tarif a changé : facture à établir dans Qonto.')).toBeInTheDocument();
  expect(screen.queryByText('La facture se propose une fois le paiement saisi.')).toBeNull();
});

test('UI3-5 — a silent refusal shows no « Facture » block', async () => {
  api.quoteResourceVisit.mockImplementation(answering({ ok: false, code: 'ISSUER_UNAVAILABLE', reason: 'Qonto non connecté.', silent: true }));
  openDialog();
  await waitFor(() => expect(api.quoteResourceVisit.mock.calls.some(([, body]) => body.payment)).toBe(true));
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.queryByText('Qonto non connecté.')).toBeNull();
  expect(screen.queryByText('Créer la facture dans Qonto')).toBeNull();
});

const refuseExtras = (error) => async (id, body) => {
  if ((body.extras || []).length > 0) throw error;
  return answering({ ok: true, code: null, reason: null })(id, body);
};

test('UI4-3 — a refusal of the draft itself is shown once, not again for the payment typed', async () => {
  api.quoteResourceVisit.mockImplementation(refuseExtras(Object.assign(new Error('Article retiré du catalogue.'), { status: 409 })));
  openDialog();
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  expect(await screen.findByText('Article retiré du catalogue.')).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.getAllByText('Article retiré du catalogue.')).toHaveLength(1);
});

test('UI4-3 — a failed draft shows one error with one « Réessayer », not a second one for the payment', async () => {
  api.quoteResourceVisit.mockImplementation(refuseExtras(Object.assign(new Error('Service indisponible'), { status: 503 })));
  openDialog();
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  expect(await screen.findByText('Service indisponible')).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Réessayer' })).toHaveLength(1);
});

test('UI5-2 — « Réessayer » on a failed draft retries the payment answer too: no second error, the arrival can be validated', async () => {
  let fail = true;
  api.quoteResourceVisit.mockImplementation(async (id, body) => {
    if (fail && (body.extras || []).length > 0) throw Object.assign(new Error('Service indisponible'), { status: 503 });
    return answering({ ok: true, code: null, reason: null })(id, body);
  });
  openDialog();
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  expect(await screen.findByText('Service indisponible')).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  fail = false;
  const paymentCalls = () => api.quoteResourceVisit.mock.calls.filter(([, body]) => body.payment && (body.extras || []).length > 0).length;
  // Loop t23 S23-1 — while the draft's amounts are unknown no payment is typed, so none is asked; once « Réessayer » brings the answer back,
  // the payment fields return and their answer is asked.
  const before = paymentCalls();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(screen.queryByText('Service indisponible')).toBeNull());
  await waitFor(() => expect(paymentCalls()).toBeGreaterThan(before));
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeEnabled());
});

// Loop t24 UI24-2 — an edit whose draft quote fails. The invoice question is asked only for a payment typed against the draft on screen,
// so no question leaves with a draft still being priced (before: it left with it and failed together). Once « Réessayer » brings the
// draft back, the payment the tenders report is a new one: its question is pending, never shown with an older « Facture non vérifiée »,
// and the focus stays in the dialog when the draft's alert goes.
test('UI24-2 — after a good « Réessayer », the new payment\'s invoice question is pending without the older failure', async () => {
  let fail = false;
  let hold = false;
  const held = [];
  api.quoteResourceVisit.mockImplementation(async (id, body) => {
    // A failing draft quote answers after a short wait, so an invoice question that left with it (the old behaviour) would fail first.
    if (fail && !body.payment) await new Promise((resolve) => { setTimeout(resolve, 30); });
    if (fail) throw Object.assign(new Error('Service indisponible'), { status: 503 });
    if (body.payment && hold) await new Promise((resolve) => { held.push(resolve); });
    return answering({ ok: true, code: null, reason: null })(id, body);
  });
  openDialog();
  const paymentCalls = (quantity) => api.quoteResourceVisit.mock.calls
    .filter(([, body]) => body.payment && (body.extras || []).some((e) => e.quantity === quantity)).length;
  const beer = await screen.findByRole('button', { name: /Bière locale/ });
  fireEvent.click(beer);
  await waitFor(() => expect(paymentCalls(1)).toBeGreaterThan(0));
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  fail = true;
  const quantity = screen.getByRole('textbox', { name: /Quantité/ });
  quantity.focus();
  fireEvent.change(quantity, { target: { value: '2' } });
  expect(await screen.findByText('Service indisponible')).toBeInTheDocument();
  expect(paymentCalls(2)).toBe(0);
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  fail = false;
  hold = true;
  const retry = screen.getByRole('button', { name: 'Réessayer' });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByText('Service indisponible')).toBeNull());
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
  expect(screen.queryAllByRole('button', { name: 'Réessayer' })).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeDisabled();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  held.splice(0).forEach((go) => go());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeEnabled());
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
});
