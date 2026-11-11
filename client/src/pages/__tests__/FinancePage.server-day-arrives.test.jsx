// specs/finance-dashboard-redesign.md rule 51, reading of 2026-11-03 (audit R20-C3) — a link the device's day refuses
// but the server's accepts is loaded as soon as the server's day is known: the refusal lifting re-asks the dashboard
// (it used to spin on « Chargement du suivi financier… » forever).
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getToday: vi.fn(), getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';
import { horizonStart } from '../../utils/dateHorizon';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

beforeEach(() => {
  vi.clearAllMocks();
  api.getFinanceDashboard.mockResolvedValue(DASHBOARD);
  api.getVatFranchise.mockResolvedValue({ applies: false });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('device refuses, server accepts: the dashboard is asked once the server\'s day is known', async () => {
  api.getToday.mockResolvedValue({ today: addIsoDays(localIsoToday(), -1) });
  const from = addIsoDays(horizonStart(localIsoToday()), -1);
  render(
    <MemoryRouter initialEntries={[`/finance?periode=custom&du=${from}&au=${addIsoDays(from, 30)}`]}>
      <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenCalledTimes(1));
  expect(api.getFinanceDashboard.mock.calls[0][0]).toMatchObject({ period: 'custom', from });
  expect(await screen.findByLabelText('Exercice')).toBeInTheDocument();
});
