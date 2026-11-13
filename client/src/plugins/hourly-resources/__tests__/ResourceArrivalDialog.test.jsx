// specs/outside-booking-sas.md rules 1, 9, 10, 13, 21 and specs/resource-booking-pricing-and-invoicing.md rules 25, 30-31 — the mini SAS of an outside client: the session and its
// price lines, the offered time, one commit with the payment and the invoice, « Pas maintenant », and a refused invoice that keeps the rest.
// specs/server-test-isolation.md rules 16, 17 — these walks run under the client suite's one 30 s budget.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { BOOKING, visitPayload, fakeQuote } from './arrivalVisitFixtures';

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
  api.quoteResourceVisit.mockImplementation(fakeQuote());
});

const validate = () => screen.getByRole('button', { name: 'Valider l’arrivée' });

test('rule 10 — the session and its price lines, the offered time, the payment and the invoice on one screen', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Jour · 18:00–19:00 · 1 h × 50,00 €')).toBeInTheDocument();
  expect(screen.getByText('Sa séance')).toBeInTheDocument();
  expect(screen.getByText('Paiement')).toBeInTheDocument();
  expect(screen.getByText('Récapitulatif')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Plus 15 minutes' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Créer la facture dans Qonto')).toBeInTheDocument());
});

test('rule 9 — the mini SAS asks nothing of the client: no name, phone or address field, only the optional billing address of an invoice', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Sa séance');
  expect(screen.getByText(/Claire Martin/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/téléphone|nom|prénom|adresse e-mail/i)).toBeNull();
  // The billing address belongs to the invoice (checked for a card): without an invoice, no address is asked.
  expect(screen.getByLabelText('Code postal')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pas maintenant' }));
  expect(screen.queryByLabelText('Code postal')).toBeNull();
});

test('rules 13, 21 — offering 15 minutes asks the server again; one commit carries the offered time, the payment and the invoice', async () => {
  const onDone = vi.fn();
  api.commitResourceVisit.mockResolvedValue({ visit: visitPayload({ booking: { ...BOOKING, arrived: true } }), invoice: { ok: true, number: 'F-1' } });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  await screen.findByText('Jour · 18:00–19:00 · 1 h × 50,00 €');
  fireEvent.click(screen.getByRole('button', { name: 'Plus 15 minutes' }));
  await waitFor(() => expect(api.quoteResourceVisit).toHaveBeenLastCalledWith(5, expect.objectContaining({ offeredMinutes: 15 }), expect.anything()));
  await screen.findAllByText(/107,50/);
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(validate());
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const [id, body] = api.commitResourceVisit.mock.calls[0];
  expect(id).toBe(5);
  expect(body.offeredMinutes).toBe(15);
  expect(body.acceptedTotalCents).toBe(10750);
  expect(body.invoice).toBe(true);
  expect(body.payment.tenders).toEqual([{ method: 'card', amountCents: 10750, internal: false }]);
});

test('rule 21 — « Pas maintenant » commits the arrival alone, with no payment and no invoice', async () => {
  api.commitResourceVisit.mockResolvedValue({ visit: visitPayload({ booking: { ...BOOKING, arrived: true } }), invoice: null });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Jour · 18:00–19:00 · 1 h × 50,00 €');
  fireEvent.click(screen.getByRole('button', { name: 'Pas maintenant' }));
  expect(screen.getByText(/reste signalée au planning/)).toBeInTheDocument();
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(validate());
  await waitFor(() => expect(api.commitResourceVisit).toHaveBeenCalled());
  const body = api.commitResourceVisit.mock.calls[0][1];
  expect(body.payment).toBeNull();
  expect(body.invoice).toBe(false);
});

test('rule 25 — Qonto asks for the address: the commit stays, the address opens, « Créer la facture » retries', async () => {
  const onDone = vi.fn();
  const paid = visitPayload({
    booking: { ...BOOKING, arrived: true, paid: true, payment: { paidAt: '2099-02-13', label: 'CB', onTheBooks: true, hasCard: true, tenders: [] } },
    totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 },
  });
  api.commitResourceVisit.mockResolvedValue({ visit: paid, invoice: { ok: false, code: 'QONTO_NEEDS_ADDRESS', error: 'adresse' } });
  api.issueResourceBookingInvoice.mockResolvedValue({});
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  await screen.findByText('Jour · 18:00–19:00 · 1 h × 50,00 €');
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(validate());
  expect(await screen.findByText('Paiement enregistré. La facture n\'a pas été créée : Qonto demande l\'adresse de facturation.')).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Code postal'), { target: { value: '07000' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Créer la facture' }).pop());
  await waitFor(() => expect(api.issueResourceBookingInvoice).toHaveBeenCalledWith(5, { billing: { street: '', postcode: '07000', city: '' } }));
  expect(onDone).toHaveBeenCalled();
});
