// specs/finance-revpar-year-over-year.md §3 rule 18 — « Taux d'occupation » draws the scope's months from
// `occupancyAll`, this exercise solid and last exercise dashed, with its table view; the small multiples
// follow only while the scope has several logements.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { COMPARED } from './financeComparisonFixtures';

const renderPage = () => render(<MemoryRouter initialEntries={['/finance']}><FinancePage /></MemoryRouter>);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(COMPARED);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({});
  api.getVatFranchise.mockReset().mockResolvedValue(null);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('rule 18 — the scope\'s series and last year\'s, named by the exercises, readable as a table', async () => {
  renderPage();
  const chart = await screen.findByRole('img', { name: "Taux d'occupation par mois, 2026 et 2025" });
  const card = chart.closest('.MuiCardContent-root');
  const legend = within(card).getByRole('group', { name: 'Séries affichées' });
  expect(within(legend).getByRole('button', { name: /2026/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(legend).getByRole('button', { name: /2025/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(card).getByRole('button', { name: 'Options du graphique' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Voir en tableau' }));
  const table = within(card).getByRole('table');
  const rows = within(table).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('juin 202625,0 %20,0 %');
  expect(rows[2]).toHaveTextContent('juillet 202640,0 %—');
  expect(within(card).getByText('Par logement')).toBeInTheDocument();
});

test('rule 18 — no comparable month last year: no dashed series', async () => {
  api.getFinanceDashboard.mockResolvedValue({
    ...COMPARED, occupancyAll: { ...COMPARED.occupancyAll, months: COMPARED.occupancyAll.months.map((m) => ({ ...m, previous: null })) },
  });
  renderPage();
  const chart = await screen.findByRole('img', { name: /Taux d'occupation par mois/ });
  const legend = within(chart.closest('.MuiCardContent-root')).getByRole('group', { name: 'Séries affichées' });
  expect(within(legend).getAllByRole('button')).toHaveLength(1);
});

test('rule 18 — one logement selected: the chart alone, no small multiple repeating it', async () => {
  api.getFinanceDashboard.mockResolvedValue({ ...COMPARED, propertyId: 1, occupancy: COMPARED.occupancy.slice(0, 1) });
  renderPage();
  const chart = await screen.findByRole('img', { name: /Taux d'occupation par mois/ });
  const card = chart.closest('.MuiCardContent-root');
  expect(card).toHaveTextContent('par mois · Gîte');
  expect(within(card).queryByText('Par logement')).toBeNull();
});
