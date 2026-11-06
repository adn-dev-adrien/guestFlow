// specs/finance-revpar-year-over-year.md §3 rules 19, 20, 24, 25 and 26, specs/finance-dashboard-redesign.md
// rules 53, 54 and 55 — review of 2026-11-06 (R3-2, R3-3, R3-4, R3-8, R3-11, R5-05, R5-20, R6-3): the pills
// name a partial span, the open nights name the occupied ones, the per-night amounts keep their cents
// under 100 €, the occupancy chart is drawn on 0-100 %, the chart cards keep their own height, « Encaissé »
// is « Déjà payé », the « Logements » tile repeats no hero figure, and the definitions state their basis.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));
const trendProps = [];
vi.mock('../../components/TrendChart', () => ({
  __esModule: true,
  default: (props) => { trendProps.push(props); return <div role="img" aria-label={props.ariaLabel} />; },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { COMPARED } from './financeComparisonFixtures';

const renderPage = () => render(<MemoryRouter initialEntries={['/finance']}><FinancePage /></MemoryRouter>);
const COMPLETE = { ...COMPARED, comparison: { ...COMPARED.comparison, complete: true, months: 12, notice: null } };

beforeEach(() => {
  trendProps.length = 0;
  api.getFinanceDashboard.mockReset().mockResolvedValue(COMPARED);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({});
  api.getVatFranchise.mockReset().mockResolvedValue(null);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('rule 19 — a complete comparison: the pills carry no span', async () => {
  api.getFinanceDashboard.mockResolvedValue(COMPLETE);
  renderPage();
  const hero = await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(hero).toHaveTextContent('(N-1 : 20,9 %)');
  expect(hero).not.toHaveTextContent('sur 12 mois');
});

test('rule 20 — the open nights name the occupied ones, the rate\'s own numerator', async () => {
  api.getFinanceDashboard.mockResolvedValue({ ...COMPARED, hero: { ...COMPARED.hero, nights: 113, openNights: 445, occupiedNights: 115 } });
  renderPage();
  const hero = await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(hero).toHaveTextContent('445nuits ouvertes · dont 115 occupées');
  expect(hero).toHaveTextContent('113nuits vendues');
});

test('rule 24 — RevPAR and its pill to the cent under 100 €', async () => {
  api.getFinanceDashboard.mockResolvedValue({
    ...COMPLETE,
    hero: { ...COMPLETE.hero, revPar: 5.26 },
    comparison: { ...COMPLETE.comparison, metrics: { ...COMPLETE.comparison.metrics, revPar: { current: 5.26, previous: 5.62, change: -6.4, unit: 'percent', comparable: true, reason: null, source: 'stays' } } },
  });
  renderPage();
  const hero = await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(hero).toHaveTextContent('5,26 €');
  expect(hero).toHaveTextContent('(N-1 : 5,62 €)');
});

test('rule 25 — the occupancy chart is drawn on 0-100 %', async () => {
  renderPage();
  await screen.findByRole('img', { name: /Taux d'occupation par mois/ });
  const props = trendProps[trendProps.length - 1];
  expect(props.yDomain).toEqual([0, 1]);
  expect(props.formatAxis(0.25)).toBe('25 %');
});

test('rule 26 — the chart row lets each card keep its own height', async () => {
  renderPage();
  const chart = await screen.findByRole('img', { name: /Taux d'occupation par mois/ });
  const row = chart.closest('.MuiGrid-container');
  expect(getComputedStyle(row).alignItems).toBe('flex-start');
});

test('dashboard rule 54 — « Encaissé » is « Déjà payé », read on the stays\' amounts', async () => {
  renderPage();
  expect(await screen.findByRole('button', { name: 'Déjà payé : afficher le détail' })).toBeInTheDocument();
  expect(screen.queryByText('Encaissé')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Définition : Déjà payé' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Sur les montants des séjours : paiements déjà reçus pour les séjours de la période/);
  expect(screen.getByRole('tooltip')).toHaveTextContent('même période de l\'an dernier');
});

test('dashboard rule 55 — one logement: the « Logements » tile names it, the RevPAR stays in the hero', async () => {
  api.getFinanceDashboard.mockResolvedValue({ ...COMPARED, propertyId: 1, tiles: { ...COMPARED.tiles, properties: { count: 1, name: 'Gîte', revenue: 2400, revPar: 53.4 } } });
  renderPage();
  const tile = (await screen.findByRole('button', { name: 'Logements : afficher le détail' })).parentElement;
  expect(tile).toHaveTextContent('Gîte');
  expect(tile).not.toHaveTextContent('RevPAR');
});

test('dashboard rule 53 — the per-night definitions state their basis: the nights, without the tourist tax', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Définition : revenu moyen / nuit' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent('revenu des nuits de la période (chaque séjour réparti sur ses nuits, options comprises, hors taxe de séjour) ÷ nuits vendues');
});
