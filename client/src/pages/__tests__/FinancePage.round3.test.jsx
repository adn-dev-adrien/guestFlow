// specs/finance-dashboard-redesign.md §3 rule 58 (D-HC20, 2026-11-06) — on a partial comparison the revenue badge
// under the window's revenue reads « vs N-1 » without its span: the notice under the card says it, once.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { COMPARED } from './financeComparisonFixtures';

const PARTIAL = { ...COMPARED, hero: { ...COMPARED.hero, yoy: { current: 3600, previous: 3000, change: 20, months: 8, totalMonths: 12 } } };

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(PARTIAL);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({});
  api.getVatFranchise.mockReset().mockResolvedValue(null);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('rule 58 — the revenue badge keeps its change and drops « sur N mois comparables »', async () => {
  render(<MemoryRouter initialEntries={['/finance']}><FinancePage /></MemoryRouter>);
  const hero = await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(within(hero).getByText('▲ +20 % vs N-1')).toBeInTheDocument();
  expect(hero).not.toHaveTextContent('mois comparables');
  expect(screen.getByRole('note')).toHaveTextContent("Comparé à l'an dernier sur 8 mois sur 12");
});
