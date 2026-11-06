// specs/finance-revpar-year-over-year.md §3 rules 28, 29 and 30; specs/finance-dashboard-redesign.md §3 rule 57 —
// fixes of 2026-11-06, round 2 (V3-2, V3-3, V5-9, D-HC16): the occupancy chart's name says « et N-1 » only with
// its series, its copied data is in percent, the page says « payé » for the stays' money, and an exercise the
// server refuses offers the current one.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));
const trendProps = [];
vi.mock('../../components/TrendChart', () => ({
  __esModule: true,
  default: (props) => { trendProps.push(props); return <div role="figure" aria-label={props.ariaLabel} />; },
}));

import api from '../../api';
import theme from '../../theme';
import FinancePage from '../FinancePage';
import FinanceDetailPanel from '../../components/FinanceDetailPanel';
import MonthlyRevenueChart from '../../components/MonthlyRevenueChart';
import { COMPARED } from './financeComparisonFixtures';
import { TO_COLLECT, MONTHS } from './financePageFixtures';

let location;
function Probe() { location = useLocation(); return null; }
const renderPage = (url = '/finance') => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path="/finance" element={<><FinancePage /><Probe /></>} /></Routes></MemoryRouter>,
);
const NO_N1 = { ...COMPARED, occupancyAll: { ...COMPARED.occupancyAll, months: COMPARED.occupancyAll.months.map((m) => ({ ...m, previous: null })) } };

beforeEach(() => {
  trendProps.length = 0;
  api.getFinanceDashboard.mockReset().mockResolvedValue(COMPARED);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({});
  api.getVatFranchise.mockReset().mockResolvedValue(null);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('rule 28 — the chart is named « et 2025 » only when last year\'s series is drawn', async () => {
  renderPage();
  expect(await screen.findByRole('figure', { name: "Taux d'occupation par mois, 2026 et 2025" })).toBeInTheDocument();
});

test('rule 28 — without a comparable month the name stops at this exercise', async () => {
  api.getFinanceDashboard.mockResolvedValue(NO_N1);
  renderPage();
  expect(await screen.findByRole('figure', { name: "Taux d'occupation par mois, 2026" })).toBeInTheDocument();
});

test('rule 29 — the occupancy chart declares its values as rates, so its copy reads in percent', async () => {
  renderPage();
  await screen.findByRole('figure', { name: /Taux d'occupation par mois/ });
  expect(trendProps[trendProps.length - 1].ratio).toBe(true);
});

test('rule 30 — « payé » for the stays\' money: the « Déjà payé » total, the projection, the month chart\'s legend', () => {
  const collected = { rows: [{ reservationId: 1, date: '2026-07-01', clientName: 'Jean Dupont', propertyName: 'Gîte', platform: 'direct', kind: 'balance', label: 'Solde', amount: 300 }, { reservationId: 2, date: '2026-07-02', clientName: 'Marie Martin', propertyName: 'Tente', platform: 'direct', kind: 'balance', label: 'Solde', amount: 200 }], totals: { amount: 500, count: 2 } }; // date-literal-ok: rows only rendered
  const common = { id: 'd', loading: false, error: false, onRetry: () => {}, windowLabel: 'Exercice 2026', staysScope: 'window', onStaysScopeChange: () => {}, until: '', onUntilChange: () => {}, onClose: () => {}, onOpenReservation: () => {}, onTogglePayment: () => {}, onSettleAll: () => {}, onSettleOverdue: () => {}, onSelectProperty: () => {} };
  const { unmount } = render(<ThemeProvider theme={theme}><FinanceDetailPanel {...common} tile="collected" data={collected} /></ThemeProvider>);
  expect(screen.getByText(/Total déjà payé · 2 paiements/)).toBeInTheDocument();
  expect(screen.queryByText(/encaissé/i)).toBeNull();
  unmount();
  const { unmount: u2 } = render(<ThemeProvider theme={theme}><FinanceDetailPanel {...common} tile="toCollect" data={{ ...TO_COLLECT, projection: { ...TO_COLLECT.projection, until: '2026-12-06' } }} /></ThemeProvider>); // date-literal-ok: echoed only
  expect(screen.getByText(/Déjà payé/)).toBeInTheDocument();
  expect(screen.queryByText(/Déjà encaissé/)).toBeNull();
  u2();
  render(<ThemeProvider theme={theme}><MonthlyRevenueChart months={MONTHS} highlightWindow={false} previousYear="2025" formatAmount={String} /></ThemeProvider>);
  expect(screen.getByText('Payé ou passé')).toBeInTheDocument();
  expect(screen.queryByText('Encaissé ou passé')).toBeNull();
});

test('finance-dashboard-redesign rule 57 — a refused exercise keeps the page alive and offers the current one', async () => {
  api.getFinanceDashboard.mockReset().mockImplementation((p) => (p.fiscalYear ? Promise.reject({ error: 'Exercice inconnu.' }) : Promise.resolve(COMPARED)));
  renderPage('/finance?exercice=2025');
  expect(await screen.findByText('Exercice inconnu.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Exercice en cours' }));
  expect(location.search).not.toContain('exercice');
  expect(await screen.findByRole('region', { name: "Chiffre d'affaires" })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: "Chiffre d'affaires" })).getByText(/Exercice 2026/)).toBeInTheDocument();
});
