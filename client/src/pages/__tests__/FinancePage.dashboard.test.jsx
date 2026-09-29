/**
 * FinancePage — the Suivi financier dashboard (specs/finance-dashboard-redesign.md rules 3-4, 12-16).
 * The page renders the server payload as is: the fixtures mirror `/finance/dashboard` and its detail
 * `toCollect` exactly.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
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

const month = (m, label, initial, revenue) => ({
  month: m, label, initial, past: revenue, upcoming: 0, revenue, revenueHt: revenue / 1.1, nights: 3,
  previous: null, previousLabel: label.replace('2026', '2025'), inWindow: true,
});
const MONTHS = [month('2026-06', 'juin 2026', 'J', 1200), month('2026-07', 'juillet 2026', 'J', 2400)];

const DASHBOARD = {
  window: { kind: 'fy', from: '2026-01-01', to: '2026-12-31', label: 'Exercice 2026', asOf: '2026-09-29' },
  fiscalYear: { key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31', isCurrent: true, previousLabel: '2025' },
  fiscalYears: [{ key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31', isCurrent: true }],
  months: MONTHS.map(({ month: m, label }) => ({ month: m, label })),
  propertyId: null,
  hero: {
    revenue: 3600, revenueHt: 3272.73, stays: 4, nights: 6, occupancy: 0.2, revenuePerNight: 600, directShare: 0.5,
    yoy: null, goal: null,
    cumulative: [{ day: '2026-06-01', current: 0, previous: null }, { day: '2026-07-31', current: 3600, previous: null }],
  },
  insights: [{ key: 'late', tone: 'info', title: 'Aucun paiement en retard', text: 'Tout est à jour.' }],
  properties: [
    { propertyId: 1, name: 'Gîte', color: '#2F5D46', revenue: 2400, occupancy: 0.3, revenuePerNight: 600 },
    { propertyId: 2, name: 'Tente', color: '#C99038', revenue: 1200, occupancy: 0.1, revenuePerNight: 600 },
  ],
  totalRevenue: 3600,
  totalOccupancy: 0.2,
  tiles: {
    collected: { amount: 3000, shareOfRevenue: 0.8333 },
    toCollect: { amount: 300, stays: 1 },
    late: { amount: 0, stays: 0 },
    stays: { count: 4, upcoming: 1 },
    properties: { count: 2, leader: 'Gîte' },
    channels: { commission: 120 },
  },
  revenueMonths: MONTHS,
  occupancy: [1, 2].map((id) => ({
    propertyId: id, name: id === 1 ? 'Gîte' : 'Tente', color: '#2F5D46', average: 0.2,
    months: MONTHS.map((m) => ({ month: m.month, label: m.label, initial: m.initial, current: 0.2, previous: null })),
  })),
};

const PENDING_ROW = {
  id: 42, firstName: 'Marie', lastName: 'Martin', propertyName: 'Tente', platform: 'direct',
  startDate: '2026-05-01', endDate: '2026-05-04', totalSejour: 300, settled: false,
  remainingToPay: 300, remainingDue: 300, depositAmount: 100, depositPaid: 0, depositDisabled: 0,
  balanceAmount: 200, balancePaid: 0, complementAmount: 0, endOfStayComplementAmount: 0,
};
const TO_COLLECT = {
  rows: [PENDING_ROW],
  totals: { depositAmount: 100, balanceAmount: 200, complementAmount: 0, endOfStayComplementAmount: 0, remainingToPay: 300, remainingDue: 300, totalSejour: 300 },
  projection: { total: 1500, collected: 900, pending: 600 },
};

let location;
function LocationProbe() { location = useLocation(); return null; }

function renderPage(entry = '/finance') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/finance" element={<><FinancePage /><LocationProbe /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(DASHBOARD);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue(TO_COLLECT);
  api.markPayment.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { delete window.matchMedia; });

test('rule 13 — no tile is open on arrival; a tile opens its table, a second click closes it', async () => {
  renderPage();
  const tile = await screen.findByRole('button', { name: 'À encaisser : afficher le détail' });
  expect(screen.queryByRole('region', { name: 'À encaisser' })).toBeNull();
  expect(api.getFinanceDashboardDetail).not.toHaveBeenCalled();

  fireEvent.click(tile);
  const panel = await screen.findByRole('region', { name: 'À encaisser' });
  await within(panel).findByText('Marie Martin');
  expect(api.getFinanceDashboardDetail).toHaveBeenCalledWith('toCollect', expect.objectContaining({ period: 'fy' }));

  fireEvent.click(screen.getByRole('button', { name: 'À encaisser : masquer le détail' }));
  expect(screen.queryByRole('region', { name: 'À encaisser' })).toBeNull();
});

test('rule 12 — the logement strip sits above the hero and filters the page through the URL (rule 4)', async () => {
  renderPage();
  const all = await screen.findByRole('radio', { name: /Tous les logements/ });
  expect(all).toHaveAttribute('aria-checked', 'true');
  const hero = screen.getByText(/Chiffre d'affaires/);
  expect(all.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(screen.getByRole('radio', { name: /Gîte/ }));
  await waitFor(() => expect(location.search).toBe('?logement=1'));
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ propertyId: '1' })));
});

test('rule 4 — the window is read back from the URL', async () => {
  renderPage('/finance?exercice=2026&periode=month&mois=2026-07');
  await screen.findByRole('radio', { name: /Tous les logements/ });
  expect(api.getFinanceDashboard).toHaveBeenCalledWith(expect.objectContaining({ fiscalYear: '2026', period: 'month', month: '2026-07' }));
});

test('rule 15 — ticking a payment PATCHes the reservation, then reloads the dashboard and the table', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'À encaisser : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'À encaisser' });
  await within(panel).findByText('Marie Martin');
  fireEvent.click(within(panel).getAllByRole('checkbox')[0]);
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(42, { depositPaid: true }));
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenCalledTimes(2));
  expect(api.getFinanceDashboardDetail).toHaveBeenCalledTimes(2);
});

test('rule 15 — a refused payment shows the server message and reloads nothing', async () => {
  api.markPayment.mockRejectedValue(new Error('Capture des contributions impossible'));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'À encaisser : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'À encaisser' });
  await within(panel).findByText('Marie Martin');
  fireEvent.click(within(panel).getAllByRole('checkbox')[0]);
  expect(await screen.findByText('Capture des contributions impossible')).toBeInTheDocument();
  expect(api.getFinanceDashboard).toHaveBeenCalledTimes(1);
});

test('rule 16 — on xs the table becomes stacked cards, checkboxes included', async () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'À encaisser : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'À encaisser' });
  await within(panel).findByText('Marie Martin');
  expect(within(panel).queryByRole('table')).toBeNull();
  expect(within(panel).getAllByRole('checkbox')).toHaveLength(2);
});
