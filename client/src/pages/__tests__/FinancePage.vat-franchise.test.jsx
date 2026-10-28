// specs/vat-optional-mode.md rules 35, 44, §6.7 — the Suivi financier loads the franchise card once (and
// on « Actualiser »), draws it between the hero and the insights, and shows nothing when the install is
// under VAT or the read fails.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';

const CARD = {
  applies: true, year: 2026, asOf: '2026-09-29', threshold: 10000, thresholdSetAt: null, collected: 8400, projected: 9000,
  ratio: 0.84, projectedRatio: 0.9, level: 'near', tone: 'warning', title: 'Seuil proche', text: 'Reste 1 600 € avant le seuil.',
  action: null, previousYear: null, settingsPath: '/settings/tva-exercice',
};

let location;
function Probe() { location = useLocation(); return null; }
const renderPage = () => render(
  <MemoryRouter initialEntries={['/finance']}>
    <Routes>
      <Route path="/finance" element={<><FinancePage /><Probe /></>} />
      <Route path="/settings/tva-exercice" element={<Probe />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(DASHBOARD);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({});
  api.getVatFranchise.mockReset().mockResolvedValue(CARD);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('the card sits between the hero and the insights, and reloads with « Actualiser »', async () => {
  renderPage();
  const card = await screen.findByRole('region', { name: 'Seuil de franchise' });
  const hero = screen.getByRole('region', { name: "Chiffre d'affaires" });
  const insights = screen.getByTestId('finance-insights');
  expect(hero.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.compareDocumentPosition(insights) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(api.getVatFranchise).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  await waitFor(() => expect(api.getVatFranchise).toHaveBeenCalledTimes(2));
});

test('outside the franchise, or when the read fails, there is no card', async () => {
  api.getVatFranchise.mockResolvedValue({ applies: false });
  const { unmount } = renderPage();
  await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(screen.queryByRole('region', { name: 'Seuil de franchise' })).not.toBeInTheDocument();
  unmount();
  api.getVatFranchise.mockRejectedValue(new Error('boom'));
  renderPage();
  await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(screen.queryByRole('region', { name: 'Seuil de franchise' })).not.toBeInTheDocument();
});

test('« Saisir le seuil » opens Paramètres › TVA & exercice', async () => {
  api.getVatFranchise.mockResolvedValue({ ...CARD, threshold: null, level: null, title: null, text: null, ratio: null, projectedRatio: null });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Saisir le seuil' }));
  await waitFor(() => expect(location.pathname).toBe('/settings/tva-exercice'));
});
