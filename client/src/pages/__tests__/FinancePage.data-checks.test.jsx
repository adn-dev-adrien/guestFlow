// specs/finance-data-checks.md §3 rules 16 and 17 — « À vérifier » sits at the bottom of the Suivi financier, reads the
// exercise the page shows and its logement, and a refusal of the checks leaves the rest of the page as it is.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn(),
    getFinancePace: vi.fn(), getFinanceDataChecks: vi.fn(),
  },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';
import { PAYLOAD } from '../../components/__tests__/dataChecksFixtures';

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(DASHBOARD);
  api.getVatFranchise.mockReset().mockResolvedValue({ applies: false });
  api.getFinancePace.mockReset().mockReturnValue(new Promise(() => {}));
  api.getFinanceDataChecks.mockReset().mockResolvedValue(PAYLOAD);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('rule 16: the panel reads the exercise of the dashboard and the logement of the URL', async () => {
  renderAt('/finance?logement=2');
  expect(await screen.findByText('Exercice 2026')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'À vérifier' })).toBeInTheDocument();
  await waitFor(() => expect(api.getFinanceDataChecks).toHaveBeenCalledWith({ fiscalYear: DASHBOARD.fiscalYear.key, propertyId: '2' }));
});

test('rule 17: a refusal of the checks keeps the dashboard and says why inside the panel', async () => {
  api.getFinanceDataChecks.mockReset().mockRejectedValue({ error: 'Logement inconnu.' });
  renderAt('/finance');
  expect(await screen.findByText('Logement inconnu.')).toBeInTheDocument();
  expect(screen.getByText('Suivi financier')).toBeInTheDocument();
  expect(screen.getByLabelText('Exercice')).toBeInTheDocument();
});
