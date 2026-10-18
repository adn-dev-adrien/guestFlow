/**
 * FinancePage — specs/finance-dashboard-redesign.md rule 39: in « Sans montant », a 0 € stay shows
 * « Montant à saisir » instead of payment chips, and the total counts the insight's nights (review of
 * PR #702, minors 4 and 5).
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

const UNPRICED = {
  scope: 'unpriced',
  rows: [{ id: 22281, clientName: 'Airbnb Reserved', propertyName: 'Gîte', startDate: '2026-10-09', endDate: '2026-10-11', platform: 'Airbnb', nights: 2, totalSejour: 0, settled: true, remainingDue: 0, depositDisabled: false, depositPaid: false, balancePaid: false, amountMissing: true }],
  totals: { count: 1, nights: 2, totalSejour: 0 },
};
const WITH_UNPRICED = {
  ...DASHBOARD,
  insights: [{ key: 'unpriced', tone: 'warning', title: '1 séjour sans montant', text: '2 nuits sans revenu sur la période : montants à saisir.', action: { label: 'Voir les séjours', tile: 'stays', scope: 'unpriced' } }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/finance']}>
      <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(WITH_UNPRICED);
  api.getFinanceDashboardDetail.mockReset().mockImplementation(async (tile, params) => (tile === 'stays' && params.scope === 'unpriced' ? UNPRICED : TO_COLLECT));
});

test('rule 39 — a 0 € stay reads « Montant à saisir », never « Réglé » or « non payé »', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Voir les séjours' }));
  const panel = await screen.findByRole('region', { name: 'Réservations' });
  expect((await within(panel).findAllByText('Montant à saisir')).length).toBeGreaterThan(0);
  expect(within(panel).queryByText('Réglé')).toBeNull();
  expect(within(panel).queryByText(/non payé/)).toBeNull();
  expect(within(panel).getByText(/1 séjour · 2 nuits/)).toBeInTheDocument();
});
