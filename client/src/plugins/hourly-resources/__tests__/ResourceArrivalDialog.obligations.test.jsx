// specs/outside-booking-sas.md rule 41 (end-review verification V-4) — the visit's open obligations (a link paid after the reste moved) are shown to the
// administrator with the server's words and « Marquer remboursé », confirmed, closed on the document, then the visit is read again; the part of the
// refund no row holds stays the « {x} à rembourser » alert. The reception's payload carries neither.
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
    patchResourceVisitLine: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
    closeStandaloneSaleObligation: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const OBLIGATION = { id: 4, amountCents: 1300, label: '13,00 € à rembourser', detail: 'Lien payé après un changement du reste' };
const paidVisit = (over = {}) => visitPayload({
  booking: { ...BOOKING, arrived: true },
  document: { ref: 'standalone:9', id: 9, status: 'paid', version: 3, client: { id: 1, label: 'Passage', kind: 'passage' } },
  lines: [sessionLine({ id: 11, ref: 'line:standalone_sale_lines:11', status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false })],
  totals: { totalCents: 12000, paidCents: 13300, remainingCents: 0, refundOwedCents: 1300, refundUnheldCents: 0 },
  refundObligations: [OBLIGATION],
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

test('V-4 — the open obligation is shown once with its words; « Marquer remboursé » confirms, closes it on the document and reads the visit again', async () => {
  api.getResourceVisit.mockResolvedValueOnce(paidVisit()).mockResolvedValueOnce(paidVisit({
    totals: { totalCents: 12000, paidCents: 13300, remainingCents: 0, refundOwedCents: 0, refundUnheldCents: 0 }, refundObligations: [],
  }));
  api.closeStandaloneSaleObligation.mockResolvedValue({});
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('13,00 € à rembourser · Lien payé après un changement du reste')).toBeInTheDocument();
  expect(screen.getAllByText(/à rembourser/)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Marquer remboursé' }));
  const confirm = await screen.findByRole('dialog', { name: 'Marquer comme remboursé ?' });
  expect(api.closeStandaloneSaleObligation).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Marquer remboursé' }));
  await waitFor(() => expect(api.closeStandaloneSaleObligation).toHaveBeenCalledWith(9, 4, 'settled'));
  await waitFor(() => expect(screen.queryByText(/à rembourser/)).toBeNull());
  expect(api.getResourceVisit).toHaveBeenCalledTimes(2);
});

test('V-4 — the unheld part (an offered paid line) stays the alert, beside the rows; the reception sees none', async () => {
  api.getResourceVisit.mockResolvedValueOnce(paidVisit({ totals: { totalCents: 12000, paidCents: 13800, remainingCents: 0, refundOwedCents: 1800, refundUnheldCents: 500 } }));
  const { unmount } = render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('5,00 € à rembourser')).toBeInTheDocument();
  expect(screen.getByText('13,00 € à rembourser · Lien payé après un changement du reste')).toBeInTheDocument();
  unmount();
  api.getResourceVisit.mockResolvedValueOnce(paidVisit({
    access: { writable: true, reason: null, reception: true }, totals: { totalCents: 12000, paidCents: 13300, remainingCents: 0 }, refundObligations: [],
  }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByTestId('remaining')).toBeInTheDocument();
  expect(screen.queryByText(/à rembourser/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Marquer remboursé' })).toBeNull();
});
