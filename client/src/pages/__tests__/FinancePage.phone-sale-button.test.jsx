// specs/pricing-components.md rule 88 (UI-17) — on a phone the bar drops « Vente hors séjour »: the day's card carries it, and when no card is drawn (a refused window) a button of the page does.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn(), getStandaloneSalesToday: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockRejectedValue({ error: 'Période inconnue.' });
  api.getVatFranchise.mockReset().mockResolvedValue({ applies: false });
  api.getStandaloneSalesToday.mockReset().mockResolvedValue({ sales: [], owed: [] });
  window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
});

test('with the dashboard refused, a phone still has « Vente hors séjour »', async () => {
  renderAt('/finance?periode=foo');
  expect(await screen.findByText('Période inconnue.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Vente hors séjour' })).toBeInTheDocument();
});
