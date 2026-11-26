// specs/gift-vouchers/gift-voucher-campaigns.md rules 15, 36 — the mini SAS shows the lines an instrument paid in advance in their own section, titled and marked by the server, counted paid by the
// server's recap; « Non pris » asks a confirmation, calls the server and adopts the visit it answers; « Ouvrir la fiche » is offered when the page gives a way.
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
    markResourceVisitLineNotTaken: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const prepaid = (notTaken = false) => ({ source: 'x', ref: 'R1', label: 'Bon 1', title: 'Compris dans le bon cadeau', mark: 'Réglé par bon', paidCents: 800, notTaken });
const extraLine = (notTaken = false) => ({
  id: 41, ref: 'option:7', kind: 'extra', label: 'Thé', detail: null, components: [], quantity: 2, unitCents: 400, totalCents: 800, catalogueCents: 800, offered: false,
  status: 'paid', statusLabel: 'Payée', settledCents: 800, vatRate: 20, legacy: false, draft: false, prepaid: prepaid(notTaken),
});
const covered = (notTaken = false) => visitPayload({
  booking: { ...BOOKING, paid: true },
  document: { ref: 'S-1', id: 9, status: 'open', version: 3, client: { id: 1, label: 'Passage', kind: 'passage' } },
  lines: [sessionLine({ id: 40, ref: 'session', status: 'paid', statusLabel: 'Payée', settledCents: 12000, draft: false }), extraLine(notTaken)],
  prepaidSections: [{ source: 'x', title: 'Compris dans le bon cadeau', mark: 'Réglé par bon', refs: ['option:7'], paidCents: 800 }],
  totals: { totalCents: 12800, paidCents: 12800, remainingCents: 0, refundOwedCents: 0 },
});

beforeEach(() => { vi.clearAllMocks(); });

test('rule 36 — the section is titled by the server, each line carries the server\'s mark, and the recap counts it paid', async () => {
  api.getResourceVisit.mockResolvedValue(covered());
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const list = await screen.findByRole('list', { name: 'Compris dans le bon cadeau' });
  expect(within(list).getByText('2 × Thé')).toBeInTheDocument();
  expect(within(list).getByText('Réglé par bon')).toBeInTheDocument();
  expect(screen.getByText('Déjà payé')).toBeInTheDocument();
  expect(screen.getByTestId('remaining')).toHaveTextContent('0,00');
});

test('rules 15, 36 — « Non pris » asks first, then calls the server and shows the visit it answers', async () => {
  api.getResourceVisit.mockResolvedValue(covered());
  api.markResourceVisitLineNotTaken.mockResolvedValue({ visit: covered(true) });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const list = await screen.findByRole('list', { name: 'Compris dans le bon cadeau' });
  fireEvent.click(within(list).getByRole('button', { name: 'Non pris' }));
  expect(api.markResourceVisitLineNotTaken).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.markResourceVisitLineNotTaken).toHaveBeenCalledWith(5, 41));
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Compris dans le bon cadeau' })).getByRole('button', { name: 'Non pris' })).toBeDisabled());
});

test('a refused mark is said on screen', async () => {
  api.getResourceVisit.mockResolvedValue(covered());
  api.markResourceVisitLineNotTaken.mockRejectedValue(new Error('Ligne déjà marquée « non pris ».'));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const list = await screen.findByRole('list', { name: 'Compris dans le bon cadeau' });
  fireEvent.click(within(list).getByRole('button', { name: 'Non pris' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Ligne déjà marquée « non pris ».')).toBeInTheDocument();
});

test('a prepaid line is not listed twice under « Proposés à l\'arrivée »', async () => {
  api.getResourceVisit.mockResolvedValue(covered());
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByRole('list', { name: 'Compris dans le bon cadeau' });
  expect(screen.getAllByText(/Thé/)).toHaveLength(1);
});

test('« Ouvrir la fiche » is offered with the page\'s way to open it', async () => {
  api.getResourceVisit.mockResolvedValue(covered());
  const onOpenFiche = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} onOpenFiche={onOpenFiche} />);
  await screen.findByRole('list', { name: 'Compris dans le bon cadeau' });
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }));
  expect(onOpenFiche).toHaveBeenCalledWith(5);
});
