// specs/sas/outside-booking-sas.md rules 24, 48 (reading of 2026-11-15, loop t1 AV-8) — an invoiced visit is closed to changes; the administrator gets « Nouvelle vente », which opens the
// counter's « Vente hors séjour » seeded with the visit's client (`visit.newSale.client`): its quote goes with `customer: { clientId }` and no name or e-mail is asked.
// A visit with `newSale: null` (not invoiced, or the reception) offers no such action.
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { BOOKING, visitPayload, sessionLine } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const CLIENT = { id: 42, label: 'Claire Martin', kind: 'registered' };
const invoicedVisit = (newSale) => visitPayload({
  booking: { ...BOOKING, arrived: true, paid: true, frozen: true, payment: { paidAt: '2099-02-13', tenders: [], label: 'Chèque', onTheBooks: true, hasCard: false }, invoice: { number: 'F-7', cancelled: false, attachment: { state: null } } },
  document: { ref: 'standalone:9', id: 9, status: 'paid', version: 3, client: CLIENT },
  lines: [sessionLine({ id: 11, status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false })],
  totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 },
  access: { writable: false, reason: 'Facturée : nouvelle vente séparée.', reception: false },
  invoice: { number: 'F-7', cancelled: false },
  invoiceable: { ok: false, code: 'BOOKING_INVOICED', reason: 'Déjà facturée.' },
  newSale,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }] });
  api.quoteStandaloneSale.mockResolvedValue({
    document: { lines: [], totals: { totalCents: 650, paidCents: 0, remainingCents: 650, refundOwedCents: 0 }, vatByRate: [] },
    customer: { clientId: 42, label: 'Claire Martin', kind: 'registered' }, refusals: [], quoted: true, paymentLink: { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null },
  });
});

test('invoiced: « Nouvelle vente » opens the counter dialog on the visit\'s client, whose quote carries its clientId', async () => {
  api.getResourceVisit.mockResolvedValue(invoicedVisit({ client: CLIENT }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle vente' }));
  const sale = await screen.findByRole('dialog', { name: 'Vente hors séjour' });
  expect(within(sale).getByText('Claire Martin')).toBeInTheDocument();
  expect(within(sale).queryByLabelText('E-mail')).toBeNull();
  expect(within(sale).queryByLabelText('Enregistrer comme client')).toBeNull();
  fireEvent.click(await within(sale).findByRole('button', { name: /Bière locale/ }));
  await waitFor(() => expect(api.quoteStandaloneSale).toHaveBeenCalled());
  expect(api.quoteStandaloneSale.mock.calls[0][0].customer).toEqual({ clientId: 42 });
});

test('no `newSale` from the server: no « Nouvelle vente »', async () => {
  api.getResourceVisit.mockResolvedValue(invoicedVisit(null));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Facturée : nouvelle vente séparée.');
  expect(screen.queryByRole('button', { name: 'Nouvelle vente' })).toBeNull();
});
