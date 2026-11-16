// specs/outside-booking-sas.md rule 56 (d) (stabilisation loop t4 B4-6) — while a draft is typed, the open rows shown are the quote's: the amounts the commit
// will leave them (a 13 € link surplus that pays the beer being added reads 6,50 €), and « Marquer remboursé » waits for the draft to be saved — the stored
// row is not what the screen shows.
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
    patchResourceVisitLine: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
    closeStandaloneSaleObligation: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const row = (amountCents, label) => ({ id: 4, origin: 'linkSurplus', amountCents, label, detail: null });
const stored = visitPayload({
  booking: { ...BOOKING, arrived: true },
  document: { ref: 'standalone:9', id: 9, status: 'paid', version: 3, client: { id: 1, label: 'Passage', kind: 'passage' } },
  lines: [sessionLine({ id: 11, ref: 'line:standalone_sale_lines:11', status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false })],
  totals: { totalCents: 12000, paidCents: 13300, remainingCents: 0, refundOwedCents: 1300, refundUnheldCents: 0 },
  refundObligations: [row(1300, '13,00 € à rembourser')],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getResourceVisit.mockResolvedValue(stored);
  api.quoteResourceVisit.mockImplementation(async () => ({
    ...stored,
    lines: [...stored.lines, {
      id: null, ref: 'draft:1', kind: 'extra', label: 'Bière locale', detail: '1 × 6,50 €', components: [], quantity: 1, unitCents: 650, totalCents: 650, catalogueCents: 650,
      offered: false, status: 'paid', statusLabel: 'Payée', settledCents: 650, vatRate: 20, legacy: false, draft: true,
    }],
    totals: { totalCents: 12650, paidCents: 13300, remainingCents: 0, refundOwedCents: 650, refundUnheldCents: 0 },
    refundObligations: [row(650, '6,50 € à rembourser')],
    quoted: true,
    refusals: [],
  }));
});

test('B4-6 — the draft shows the row at the quote\'s amount, its action disabled until the draft is saved', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('13,00 € à rembourser')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marquer remboursé' })).toBeEnabled();
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  expect(await screen.findByText('6,50 € à rembourser')).toBeInTheDocument();
  expect(screen.queryByText('13,00 € à rembourser')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Marquer remboursé' })).toBeDisabled());
});

test('UI5-3 — while the draft is typed, the dead « Marquer remboursé » states why', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('13,00 € à rembourser')).toBeInTheDocument();
  expect(screen.queryByText('Enregistrer d’abord les articles ajoutés.')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  expect(await screen.findByText('Enregistrer d’abord les articles ajoutés.')).toBeInTheDocument();
});
