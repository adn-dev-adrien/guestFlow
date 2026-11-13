// specs/outside-booking-sas.md rules 7, 13, 14, 25 — « Offrir » on the session and on an extra: an offered line is struck through at its catalogue value; a stored line is changed by an
// explicit action; a paid line asks the administrator's confirmation of the refund it owes (the refund amount is the server's, hidden from the reception).
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { BOOKING, visitPayload, sessionLine, fakeQuote } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    patchResourceVisitLine: vi.fn(),
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

test('rule 13 — « Offrir » on an extra: the line is asked offered, its catalogue value stays struck through, the total drops', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  const list = await screen.findByRole('list', { name: 'Proposés à l’arrivée' });
  fireEvent.click(await within(list).findByRole('button', { name: 'Offrir' }));
  await waitFor(() => expect(api.quoteResourceVisit).toHaveBeenLastCalledWith(5, expect.objectContaining({ extras: [{ articleRef: 'option:7', quantity: 1, offered: true }] }), expect.anything()));
  const struck = await within(list).findByText('6,50 €', { selector: 'del' });
  expect(struck).toBeInTheDocument();
  expect(within(list).getByRole('button', { name: 'Offert' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('120,00'));
});

test('rule 13 — « Offrir » on the session offers the whole line', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Sa séance');
  fireEvent.click(screen.getAllByRole('button', { name: 'Offrir' })[0]);
  await waitFor(() => expect(api.quoteResourceVisit).toHaveBeenLastCalledWith(5, expect.objectContaining({ sessionOffered: true }), expect.anything()));
  await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('0,00'));
});

const storedVisit = (over = {}) => visitPayload({
  booking: { ...BOOKING, arrived: true },
  document: { ref: 'standalone:9', id: 9, status: 'due', version: 3, client: { id: 1, label: 'Passage', kind: 'passage' } },
  lines: [
    sessionLine({ id: 11, ref: 'line:standalone_sale_lines:11', status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false }),
    {
      id: 12, ref: 'line:standalone_sale_lines:12', kind: 'extra', label: 'Bière locale', detail: '2 × 6,50 €', components: [], quantity: 2, unitCents: 650, totalCents: 1300, catalogueCents: 1300,
      offered: false, status: 'due', statusLabel: 'À payer', settledCents: 0, vatRate: 20, legacy: false, draft: false,
    },
  ],
  totals: { totalCents: 13300, paidCents: 12000, remainingCents: 1300, refundOwedCents: 0 },
  ...over,
});

test('rules 14, 23 — a stored unpaid line is offered by an explicit action carrying the document version, and the answer replaces the visit', async () => {
  api.getResourceVisit.mockResolvedValue(storedVisit());
  api.patchResourceVisitLine.mockResolvedValue({ visit: storedVisit({
    totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 },
  }) });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const list = await screen.findByRole('list', { name: 'Proposés à l’arrivée' });
  fireEvent.click(within(list).getByRole('button', { name: 'Offrir' }));
  await waitFor(() => expect(api.patchResourceVisitLine).toHaveBeenCalledWith(5, 12, { offered: true, version: 3 }));
  await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('0,00'));
});

test('rule 25 — a paid line asks the confirmation of the refund; « Confirmer » repeats the action with confirmRefund; « {x} à rembourser » is the server\'s figure', async () => {
  api.getResourceVisit.mockResolvedValue(storedVisit());
  const error = Object.assign(new Error('Ligne payée : remboursement à confirmer.'), { code: 'LINE_PAID', status: 409 });
  api.patchResourceVisitLine.mockRejectedValueOnce(error).mockResolvedValueOnce({ visit: storedVisit({
    totals: { totalCents: 800, paidCents: 12000, remainingCents: 0, refundOwedCents: 1500 },
  }) });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Offrir' }))[0]);
  const confirm = await screen.findByRole('dialog', { name: 'Remboursement' });
  expect(within(confirm).getByText('Ligne payée : remboursement à confirmer.')).toBeInTheDocument();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.patchResourceVisitLine).toHaveBeenLastCalledWith(5, 11, { offered: true, confirmRefund: true, version: 3 }));
  expect(await screen.findByText('15,00 € à rembourser')).toBeInTheDocument();
});

test('rule 7 — the reception is never asked to confirm a refund: the server\'s refusal is shown as it is, and it sees no refund amount', async () => {
  api.getResourceVisit.mockResolvedValue(storedVisit({
    access: { writable: true, reason: null, reception: true },
    totals: { totalCents: 13300, paidCents: 12000, remainingCents: 1300 },
  }));
  api.patchResourceVisitLine.mockRejectedValue(Object.assign(new Error('Remboursement : réservé à l’administrateur.'), { code: 'ADMIN_ONLY', status: 403 }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Offrir' }))[0]);
  expect(await screen.findByText('Remboursement : réservé à l’administrateur.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Remboursement' })).toBeNull();
  expect(screen.queryByText(/à rembourser/)).toBeNull();
  expect(screen.queryByText('Facture')).toBeNull();
});
