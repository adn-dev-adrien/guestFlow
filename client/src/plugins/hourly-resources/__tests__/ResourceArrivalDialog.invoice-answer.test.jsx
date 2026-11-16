// specs/outside-booking-sas.md rule 54 (reading 2026-11-16, loop t3 UI3-4, UI3-5) — at « Payé maintenant » the arrival reads the server's answer for
// the payment typed: a failed answer shows « Facture non vérifiée pour ce paiement. » with « Réessayer » (the commit waits for it, never silently);
// « Caisse interne » is the server's `INTERNAL_CASH`, and any other refusal prints the server's reason.
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
