/**
 * FinancePage — the Suivi financier dashboard (specs/accounting/finance-dashboard-redesign.md rules 3-4, 12-16).
 * The page renders the server payload as is: the fixtures mirror `/finance/dashboard` and its detail
 * `toCollect` exactly (the month-grouped payments of specs/planning/mobile-dashboard-exercise-cash.md).
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

import { DASHBOARD, TO_COLLECT } from './financePageFixtures';

let location;
function LocationProbe() { location = useLocation(); return null; }

function renderPage(entry = '/finance') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/finance" element={<><FinancePage /><LocationProbe /></>} /><Route path="/reservations/:id" element={<LocationProbe />} /></Routes>
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
  const tile = await screen.findByRole('button', { name: 'Reste à encaisser : afficher le détail' });
  expect(screen.queryByRole('region', { name: 'Reste à encaisser' })).toBeNull();
  expect(api.getFinanceDashboardDetail).not.toHaveBeenCalled();

  fireEvent.click(tile);
  const panel = await screen.findByRole('region', { name: 'Reste à encaisser' });
  await within(panel).findByText('Marie Martin');
  expect(api.getFinanceDashboardDetail).toHaveBeenCalledWith('toCollect', expect.objectContaining({ period: 'fy' }));

  fireEvent.click(screen.getByRole('button', { name: 'Reste à encaisser : masquer le détail' }));
  expect(screen.queryByRole('region', { name: 'Reste à encaisser' })).toBeNull();
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

test('rule 16 of mobile-dashboard-exercise-cash — a line of « Reste à encaisser » opens the fiche and ticks nothing', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Reste à encaisser : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'Reste à encaisser' });
  fireEvent.click(await within(panel).findByRole('button', { name: /Solde de Marie Martin/ }));
  await waitFor(() => expect(location.pathname).toBe('/reservations/42'));
  expect(api.markPayment).not.toHaveBeenCalled();
});

test('rule 16 — on xs the lines are stacked cards: date and amount, then client · logement · kind', async () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Reste à encaisser : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'Reste à encaisser' });
  await within(panel).findByText('Marie Martin');
  expect(within(panel).queryByRole('table')).toBeNull();
  expect(within(panel).getByText('Marie Martin · Tente · Solde')).toBeInTheDocument();
});
