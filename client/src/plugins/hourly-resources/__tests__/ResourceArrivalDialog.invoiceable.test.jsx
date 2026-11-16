// specs/resource-booking-pricing-and-invoicing.md rules 13, 44, 45 and specs/outside-booking-sas.md rules 31, 48 (loop t1 UI-10 / AV-11, CLAUDE.md §6.0) — whether the money on the
// books can be invoiced now is the server's `visit.invoiceable`: « Créer la facture » iff `ok`, its `reason` otherwise; the reception's payload carries `null` and no invoice block.
// The dialog derives nothing from the remaining, the payment or Qonto's state.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const CHEQUE = { paidAt: '2099-02-13', tenders: [{ method: 'cheque', amountCents: 12000 }], label: 'Chèque', onTheBooks: true, hasCard: false };
const arrivedPaid = (invoiceable, over = {}) => visitPayload({
  booking: { ...BOOKING, arrived: true, paid: true, payment: CHEQUE },
  lines: [sessionLine({ status: 'paid', statusLabel: 'Payée', settledCents: 12000, legacy: true, draft: false })],
  totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 },
  session: { offeredMinutes: 0, editable: false },
  invoiceable,
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

test('ok — « Créer la facture » is offered and issues the invoice of the arrived visit', async () => {
  api.getResourceVisit.mockResolvedValue(arrivedPaid({ ok: true, code: null, reason: null }));
  api.issueResourceBookingInvoice.mockResolvedValue({});
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  const buttons = await screen.findAllByRole('button', { name: 'Créer la facture' });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(api.issueResourceBookingInvoice).toHaveBeenCalledWith(5, expect.anything()));
  expect(onDone).toHaveBeenCalled();
});

test('refused — the server\'s reason is shown and nothing offers an invoice, even with everything paid and Qonto ready', async () => {
  api.getResourceVisit.mockResolvedValue(arrivedPaid({ ok: false, code: 'TARIFF_CHANGED', reason: 'Le tarif a changé depuis le paiement : facture à établir dans Qonto.' }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Le tarif a changé depuis le paiement : facture à établir dans Qonto.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Créer la facture' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeEnabled();
});

test('the reception (invoiceable null): no invoice block at all', async () => {
  api.getResourceVisit.mockResolvedValue(arrivedPaid(null, { access: { writable: true, reason: null, reception: true } }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Payée');
  expect(screen.queryByText('Facture')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Créer la facture' })).toBeNull();
});
