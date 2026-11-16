// specs/outside-booking-sas.md rule 53 (stabilisation loop t2, B2-7; CLAUDE.md §6.0) — at « Payé maintenant » the arrival asks the server, with the payment typed,
// whether its commit could make the invoice; « Créer la facture dans Qonto » follows that answer, never the tenders.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
  api.getResourceVisit.mockResolvedValue(visitPayload());
});

test('B2-7 — the quote of the payment typed says yes: the checkbox is offered; the quote carried the tenders', async () => {
  api.quoteResourceVisit.mockImplementation(fakeQuote());
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  const asked = api.quoteResourceVisit.mock.calls.map(([, body]) => body).find((body) => body.payment);
  expect(asked.payment.tenders).toEqual([{ method: 'card', amountCents: 12000, internal: false }]);
});

test('B2-7 — the server says no for a payment on the books: no checkbox', async () => {
  const quote = fakeQuote();
  api.quoteResourceVisit.mockImplementation(async (id, body) => ({
    ...(await quote(id, body)), ...(body.payment ? { invoiceable: { ok: false, code: 'REFUND_OWED', reason: 'Remboursement à faire : facture après le remboursement.' } } : {}),
  }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await waitFor(() => expect(api.quoteResourceVisit.mock.calls.some(([, body]) => body.payment)).toBe(true));
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.queryByText('Créer la facture dans Qonto')).toBeNull();
});
