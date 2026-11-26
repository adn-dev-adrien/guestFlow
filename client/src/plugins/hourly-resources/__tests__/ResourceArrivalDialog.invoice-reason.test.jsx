// specs/sas/outside-booking-sas.md rule 48 (loop t2 UI2-5) — the « Facture » reason is the stored visit's: shown only while nothing is typed, and never for a refusal
// the server marks `silent` (no Qonto on the install, nothing to invoice, no payment yet) — a paid visit on an install without Qonto shows no invoice block.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

const REMAINING_DUE = { ok: false, code: 'REMAINING_DUE', reason: 'Reste à payer : facture après le solde.', silent: false };
const reopened = (invoiceable, over = {}) => visitPayload({
  booking: { ...BOOKING, arrived: true },
  lines: [sessionLine({ id: 12, ref: 'line:standalone_sale_lines:12', status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false })],
  totals: { totalCents: 13000, paidCents: 12000, remainingCents: 1300, refundOwedCents: 0 },
  invoiceable,
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

test('a silent refusal (no Qonto) shows no « Facture » block on a paid visit', async () => {
  api.getResourceVisit.mockResolvedValue(reopened({ ok: false, code: 'ISSUER_UNAVAILABLE', reason: 'Facturation Qonto non connectée.', silent: true }, {
    totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 }, invoiceReady: false,
  }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Payée');
  expect(screen.queryByText('Facturation Qonto non connectée.')).toBeNull();
  expect(screen.queryByText('Facture')).toBeNull();
});

test('a stored reste reads its reason; taking the payment hides it, the save answers its own invoice', async () => {
  api.getResourceVisit.mockResolvedValue(reopened(REMAINING_DUE));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Reste à payer : facture après le solde.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }));
  expect(screen.queryByText('Reste à payer : facture après le solde.')).toBeNull();
});
