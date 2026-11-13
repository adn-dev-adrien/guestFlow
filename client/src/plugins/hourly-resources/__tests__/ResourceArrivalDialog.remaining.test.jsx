// specs/outside-booking-sas.md rules 4, 15-18, 22 (CLAUDE.md §6.0) — every figure of the mini SAS is the server's: Total, Déjà payé, Reste à payer and the VAT rows are rendered from the
// payload, never computed (the payload here is deliberately not the sum of its lines); « Rien à encaisser. » when nothing is left; a payment below the reste offers « Reste à percevoir » only.
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

beforeEach(() => { vi.clearAllMocks(); });

test('rules 4, 15 — the figures are the payload\'s, even when they are not the sum of the lines', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload({
    totals: { totalCents: 98765, paidCents: 45000, remainingCents: 53765, refundOwedCents: 0 },
    vatByRate: [{ rate: 20, vatCents: 12345 }, { rate: 10, vatCents: 678 }],
  }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('987,65 €')).toBeInTheDocument();
  expect(screen.getByText('Déjà payé')).toBeInTheDocument();
  expect(screen.getByText('450,00 €')).toBeInTheDocument();
  expect(screen.getByTestId('remaining')).toHaveTextContent('537,65 €');
  expect(screen.getByText('dont TVA 20 % : 123,45 €')).toBeInTheDocument();
  expect(screen.getByText('dont TVA 10 % : 6,78 €')).toBeInTheDocument();
});

test('rule 15 — « Déjà payé » appears only once something was paid', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload());
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByTestId('remaining');
  expect(screen.queryByText('Déjà payé')).toBeNull();
});

test('rule 18 — nothing left to pay: « Rien à encaisser. », no payment lines, and « Valider l\'arrivée » still records the arrival', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload({
    lines: [sessionLine({ totalCents: 0, offered: true, status: 'offered', statusLabel: 'Offerte' })],
    totals: { totalCents: 0, paidCents: 0, remainingCents: 0, refundOwedCents: 0 }, vatByRate: [],
  }));
  api.commitResourceVisit.mockResolvedValue({ visit: visitPayload({ booking: { ...BOOKING, arrived: true } }), invoice: null });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  expect(await screen.findByText('Rien à encaisser.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Encaisser' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Valider l’arrivée' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(api.commitResourceVisit.mock.calls[0][1].payment).toBeNull();
});

test('rule 17 — a payment below the reste offers « Reste à percevoir » only (no « Geste commercial »), and the commit sends it as the shortfall', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload());
  api.commitResourceVisit.mockResolvedValue({ visit: visitPayload({ booking: { ...BOOKING, arrived: true } }), invoice: null });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const amount = await screen.findByRole('textbox', { name: 'Montant CB' });
  fireEvent.change(amount, { target: { value: '50' } });
  expect(await screen.findByRole('button', { name: /Reste à percevoir/ })).toBeInTheDocument();
  expect(screen.queryByText('Geste commercial')).toBeNull();
  expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Reste à percevoir/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Valider l’arrivée' }));
  await waitFor(() => expect(api.commitResourceVisit).toHaveBeenCalled());
  const { payment } = api.commitResourceVisit.mock.calls[0][1];
  expect(payment.tenders).toEqual([{ method: 'card', amountCents: 5000, internal: false }]);
  expect(payment.shortfall).toEqual({ kind: 'due' });
});

test('rule 22 — a reopened visit starts on « Pas maintenant »: closing it collects nothing, and the reste can be collected with « Encaisser »', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload({
    booking: { ...BOOKING, arrived: true },
    lines: [sessionLine({ id: 12, ref: 'line:standalone_sale_lines:12', status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false })],
    totals: { totalCents: 13000, paidCents: 12000, remainingCents: 1300, refundOwedCents: 0 },
  }));
  const onClose = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={onClose} onDone={() => {}} />);
  expect(await screen.findByTestId('remaining')).toHaveTextContent('13,00 €');
  expect(screen.getByRole('button', { name: 'Pas maintenant' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalled();
  expect(api.commitResourceVisit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
});
