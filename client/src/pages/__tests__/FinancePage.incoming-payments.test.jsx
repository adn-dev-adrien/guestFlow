// specs/mollie-rolling-reserve-and-incoming-payments.md rules 21-24, 26 — the « Versements à venir » tile of the Suivi
// financier: the server's figure and caption, a click opens the detail read from /finance/incoming (never from the
// windowed dashboard detail), « Reçus ces 30 derniers jours » re-reads the other payload, a line opens its fiche.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getIncomingPayments: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import DialogProvider from '../../components/DialogProvider';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';

const ITEM = {
  key: 'mollie:101|balance#retenue', kind: 'mollieReserve', label: 'Retenue Mollie', icon: 'hourglass', natureLabel: 'Retenue Mollie',
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  natureDetail: '20 % retenus pendant 90 jours · Solde', amountCents: 14648, expectedDate: '2027-02-11', receivedDate: null,
  dateLabel: 'jeu. 11/02', state: 'upcoming', stateLabel: 'Dans 3 mois', tone: 'neutral', refs: { qonto: null, mollieSettlement: null, molliePayment: null },
};
const INCOMING = {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  totals: { amount: 146.48, amountCents: 14648, clients: 1, nextDate: '2027-02-11', nextDateLabel: 'jeu. 11/02' },
  kinds: [{ key: 'mollieReserve', label: 'Retenue Mollie', count: 1 }],
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  clients: [{ clientId: 1, name: 'Jean Dupont', totalCents: 14648, nextDate: '2027-02-11', nextDateLabel: 'jeu. 11/02', late: false,
    stays: [{ reservationId: 101, label: 'Cabane · 01/11 → 05/11/2026', items: [ITEM] }] }],
};
const RECENT = { ...INCOMING, totals: { ...INCOMING.totals, nextDate: null, nextDateLabel: null }, clients: [{ ...INCOMING.clients[0], stays: [{ ...INCOMING.clients[0].stays[0], items: [{ ...ITEM, state: 'received', tone: 'success', stateLabel: 'Reçu le 30/10' }] }] }] };

// date-literal-ok: fixture data drawn as given; nothing compares it with today
const WITH_TILE = { ...DASHBOARD, tiles: { ...DASHBOARD.tiles, incoming: { amount: 146.48, clients: 1, nextDate: '2027-02-11', nextDateLabel: 'jeu. 11/02' } } };

function renderPage() {
  return render(
    <DialogProvider>
      <MemoryRouter initialEntries={['/finance']}>
        <Routes>
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/reservations/:id" element={<div>Fiche ouverte</div>} />
        </Routes>
      </MemoryRouter>
    </DialogProvider>,
  );
}

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(WITH_TILE);
  api.getFinanceDashboardDetail.mockReset();
  api.getIncomingPayments.mockReset().mockImplementation(async ({ recent } = {}) => (recent ? RECENT : INCOMING));
});

test('rule 21: the tile reads the server\'s figure with the client count and the next date', async () => {
  renderPage();
  const tile = await screen.findByRole('button', { name: 'Versements à venir : afficher le détail' });
  expect(within(tile).getByText(/146\s?€/)).toBeInTheDocument();
  expect(within(tile).getByText('1 client · prochain le jeu. 11/02')).toBeInTheDocument();
});

test('rule 21: a dashboard without the tile (no payload field) shows no tile', async () => {
  api.getFinanceDashboard.mockResolvedValue(DASHBOARD);
  renderPage();
  await screen.findByRole('button', { name: 'En retard : afficher le détail' });
  expect(screen.queryByRole('button', { name: /Versements à venir/ })).not.toBeInTheDocument();
});

test('rules 22, 26: opening the tile reads /finance/incoming, not the windowed dashboard detail', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Versements à venir : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'Versements à venir' });
  expect(await within(panel).findByRole('region', { name: 'Jean Dupont' })).toBeInTheDocument();
  expect(api.getIncomingPayments).toHaveBeenCalledWith({ recent: false });
  expect(api.getFinanceDashboardDetail).not.toHaveBeenCalled();
});

test('rule 24: « Reçus ces 30 derniers jours » re-reads the recent payload', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Versements à venir : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'Versements à venir' });
  await userEvent.click(await within(panel).findByRole('switch', { name: 'Reçus ces 30 derniers jours' }));
  expect(await within(panel).findByText('Reçu le 30/10')).toBeInTheDocument();
  expect(api.getIncomingPayments).toHaveBeenLastCalledWith({ recent: true });
});

test('rule 22: the header of a client opens its fiche', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Versements à venir : afficher le détail' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Ouvrir la fiche : Jean Dupont' }));
  expect(await screen.findByText('Fiche ouverte')).toBeInTheDocument();
});
