/**
 * FinancePage — specs/finance-dashboard-redesign.md rules 34-36: « En retard » lists the platforms'
 * late payouts beside the guests' late payments, the « séjours sans montant » insight opens the stays
 * that carry no amount, and the wording reads impersonal (mega review #5, B2, M1, N3, m5).
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getFinanceDashboard: vi.fn(),
    getFinanceDashboardDetail: vi.fn(),
    markPayment: vi.fn(),
  },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD, TO_COLLECT } from './financePageFixtures';

const LATE = {
  rows: [{
    id: 13, firstName: 'Paul', lastName: 'Durand', propertyName: 'Gîte', platform: 'GitesDeFrance',
    startDate: '2026-09-28', endDate: '2026-10-01', overdueAmount: 706, oldestDueDate: '2026-10-08', isOverdue: true,
    payoutOverdue: true, overdueItems: [{ kind: 'payout', label: 'Versement Gîtes de France', amount: 706, dueDate: '2026-10-08' }],
  }],
  totals: { amount: 706, count: 1, payouts: { count: 1, totalAmount: 706 } },
};
const UNPRICED = {
  scope: 'unpriced',
  rows: [{ id: 22281, clientName: 'Airbnb Reserved', propertyName: 'Gîte', startDate: '2026-10-09', endDate: '2026-10-11', platform: 'Airbnb', nights: 2, totalSejour: 0, settled: true, remainingDue: 0, depositDisabled: true, depositPaid: false, balancePaid: false }],
  totals: { count: 1, nights: 2, totalSejour: 0 },
};

const WITH_FACTS = {
  ...DASHBOARD,
  insights: [
    { key: 'late', tone: 'error', title: '1 séjour en retard de paiement', text: '706 € de versement plateforme attendu : tuile « En retard ».' },
    { key: 'unpriced', tone: 'warning', title: '1 séjour sans montant', text: 'Nuits déjà couvertes par un autre séjour : doublons à vérifier.', action: { label: 'Voir les séjours', tile: 'stays', scope: 'unpriced' } },
  ],
  tiles: { ...DASHBOARD.tiles, late: { amount: 706, stays: 1, payouts: 1 } },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/finance']}>
      <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(WITH_FACTS);
  api.getFinanceDashboardDetail.mockReset().mockImplementation(async (tile, params) => {
    if (tile === 'late') return LATE;
    if (tile === 'stays' && params.scope === 'unpriced') return UNPRICED;
    return TO_COLLECT;
  });
});

test('rule 34 — a late platform payout is a chip of the « En retard » table', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'En retard : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'En retard' });
  expect(await within(panel).findByText(/Versement Gîtes de France 706,00\s€ · échu 08\/10\/2026/)).toBeInTheDocument();
});

test('rule 35 — « Voir les séjours » opens the stays without an amount', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Voir les séjours' }));
  const panel = await screen.findByRole('region', { name: 'Réservations' });
  expect(api.getFinanceDashboardDetail).toHaveBeenLastCalledWith('stays', expect.objectContaining({ scope: 'unpriced' }));
  expect(within(panel).getByRole('button', { name: 'Sans montant' })).toHaveAttribute('aria-pressed', 'true');
  expect(await within(panel).findByText('Airbnb Reserved')).toBeInTheDocument();
});

test('rule 36 — the channels tile reads « de commissions », without a minus sign', async () => {
  renderPage();
  const tile = await screen.findByRole('button', { name: 'Canaux : afficher le détail' });
  expect(within(tile).getByText('de commissions')).toBeInTheDocument();
  expect(tile.textContent).not.toMatch(/−/);
});

test('rule 36 — the projection field reads « Encaissable d\'ici le » and starts on the server\'s date', async () => {
  api.getFinanceDashboardDetail.mockResolvedValue({ ...TO_COLLECT, projection: { ...TO_COLLECT.projection, until: '2026-11-18' } });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'À encaisser : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'À encaisser' });
  const field = await within(panel).findByLabelText("Encaissable d'ici le");
  expect(field).toHaveValue('2026-11-18');
  expect(api.getFinanceDashboardDetail).toHaveBeenCalledWith('toCollect', expect.not.objectContaining({ until: expect.anything() }));
});
