// specs/gift-voucher-campaigns.md rule 53 — « Passage » : the fiche of an outside booking renders what the server answers (client, session, lines with « Réglé par … », payments,
// refund lines, terms, arrival) and the history newest first; « Arrivée » opens the mini SAS; the loading and error states use the generic components.
import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import OutsideBookingPage from '../OutsideBookingPage';
import api from '../../../api';

vi.mock('../../../api', () => ({ default: { getResourceBookingFiche: vi.fn() } }));
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }), useAppDialogs: () => ({ confirm: vi.fn() }) }));
vi.mock('../ResourceArrivalDialog', () => ({ default: ({ bookingId }) => <div data-testid="arrival-dialog">{bookingId}</div> }));

const FICHE = {
  booking: { id: 12, resourceName: 'Bain nordique', date: '2099-03-04', startTime: '18:00', endTime: '19:00', notes: '' },
  client: { name: 'Claire Martin', email: 'claire@example.test', phone: '0600000000', clientId: 7 },
  sessions: [{ date: '2099-03-04', start: '18:00', end: '19:00', resourceName: 'Bain nordique' }],
  lines: [
    { ref: 'a', label: 'Bain nordique', quantity: 1, totalCents: 6000, status: 'paid', statusLabel: 'Payée', session: true, notTaken: false, paidBy: [{ kind: 'prepaid', label: 'Bon cadeau BC-1', amountCents: 6000 }] },
    { ref: 'b', label: 'Thé', quantity: 2, totalCents: 800, status: 'paid', statusLabel: 'Payée', session: false, notTaken: true, paidBy: [{ kind: 'card', label: 'Carte', amountCents: 800 }] },
  ],
  totals: { totalCents: 6800, paidCents: 6800, remainingCents: 0 },
  payments: [{ id: 1, paidAt: '2099-03-01 10:00:00', receivedCents: 800, tenders: [{ label: 'Carte', amountCents: 800 }] }],
  refunds: [{ id: 3, label: 'Remboursement Thé', detail: '4,00 €' }],
  terms: [{ activity: 'resource', activityLabel: 'Bain nordique et activités', version: 2, acceptedAt: '2099-03-01 10:00:00', channel: 'site', channelLabel: 'Site' }],
  arrival: { state: 'expected', at: null },
  history: [
    { at: '2099-03-02 09:00:00', text: 'Paiement reçu', actor: null },
    { at: '2099-03-01 10:00:00', text: 'Réservation créée', actor: 'Site' },
  ],
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/passages/12']}>
    <Routes><Route path="/passages/:bookingId" element={<OutsideBookingPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { vi.clearAllMocks(); });

test('the blocks come from the server: client, session, lines paid by, payments, refund, terms, arrival', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: FICHE });
  renderPage();
  expect((await screen.findAllByText(/Claire Martin/)).length).toBeGreaterThan(0);
  expect(api.getResourceBookingFiche).toHaveBeenCalledWith('12');
  expect(screen.getByText('claire@example.test')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Fiche client' })).toHaveAttribute('href', '/clients?clientId=7');
  const sales = screen.getByRole('region', { name: 'Ventes' });
  expect(within(sales).getByText('Réglé par Bon cadeau BC-1')).toBeInTheDocument();
  expect(within(sales).getByText('Réglé par Carte')).toBeInTheDocument();
  expect(within(sales).getByText('Non pris')).toBeInTheDocument();
  expect(screen.getByText('Remboursement Thé · 4,00 €')).toBeInTheDocument();
  expect(screen.getByText(/Bain nordique et activités · version 2/)).toBeInTheDocument();
  expect(screen.getByText('Attendu')).toBeInTheDocument();
});

test('the history is shown in the order the server sends it, newest first', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: FICHE });
  renderPage();
  const list = await screen.findByRole('list', { name: 'Historique' });
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent.split(/\d/)[0])).toEqual(['Paiement reçu', 'Réservation créée']);
});

test('« Arrivée » in the page bar opens the visit of this booking', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: FICHE });
  renderPage();
  await screen.findByRole('list', { name: 'Historique' });
  fireEvent.click(screen.getByRole('button', { name: 'Arrivée' }));
  expect(screen.getByTestId('arrival-dialog')).toHaveTextContent('12');
});

test('a booking with nothing sold says so', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: { ...FICHE, lines: [], totals: null, payments: [], refunds: [], terms: [] } });
  renderPage();
  expect(await screen.findByText('Aucune vente enregistrée.')).toBeInTheDocument();
  expect(screen.getByText('Aucun paiement.')).toBeInTheDocument();
  expect(screen.getByText('Aucune acceptation enregistrée.')).toBeInTheDocument();
});

test('a failed load shows the error with a retry', async () => {
  api.getResourceBookingFiche.mockRejectedValueOnce(new Error('Réservation non trouvée')).mockResolvedValue({ fiche: FICHE });
  renderPage();
  expect(await screen.findByText('Réservation non trouvée')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
  await waitFor(() => expect(screen.getByText('Attendu')).toBeInTheDocument());
});
