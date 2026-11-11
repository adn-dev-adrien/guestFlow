// specs/finance-dashboard-redesign.md rule 51, reading of 2026-11-03 (audit R20-C1) — no window the server refuses is a
// dead end. A custom date that is not a real day (5-digit year, 30 February) or a single date is refused before any
// request, the selector shown; any other refusal of the server (a month outside the exercise, an unknown period or
// logement) keeps the period selector under the error, so the window is fixed in place, not through the sidebar.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';
import { PERIOD_MESSAGES } from '../../components/PeriodSelector';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(DASHBOARD);
  api.getFinanceDashboardDetail.mockReset();
  api.getVatFranchise.mockReset().mockResolvedValue({ applies: false });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

const T = localIsoToday();
const FROM = addIsoDays(T, -20);
const TO = addIsoDays(T, 10);

test.each([
  ['a 5-digit « Au »', `du=${FROM}&au=2${TO}`, `2${TO}`],
  ['a single date', `du=${FROM}`, ''],
  ['30 February', `du=${Number(T.slice(0, 4)) - 1}-02-30&au=${TO}`, TO],
])('a link with %s sends nothing and keeps the selector', async (_name, query, shownTo) => {
  renderAt(`/finance?periode=custom&${query}`);
  expect(await screen.findByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.missingDates);
  expect(screen.getByLabelText('Au')).toHaveValue(shownTo);
  expect(api.getFinanceDashboard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Exercice' }));
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenCalledTimes(1));
  expect(api.getFinanceDashboard.mock.calls[0][0]).toMatchObject({ period: 'fy', from: '', to: '' });
});

test.each([
  ['a month outside the exercise', `periode=month&mois=${Number(T.slice(0, 4)) - 7}-01`, "Ce mois n'appartient pas à l'exercice choisi."],
  ['an unknown period', 'periode=foo', 'Période inconnue.'],
])('a server refusal of %s keeps the period selector under the error', async (_name, query, message) => {
  api.getFinanceDashboard.mockReset()
    .mockRejectedValueOnce({ error: message })
    .mockResolvedValue(DASHBOARD);
  renderAt(`/finance?${query}`);
  expect(await screen.findByText(message)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Exercice' }));
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenCalledTimes(2));
  expect(api.getFinanceDashboard.mock.calls[1][0]).toMatchObject({ period: 'fy', month: '' });
  expect(await screen.findByLabelText('Exercice')).toBeInTheDocument();
});

test('an unknown logement offers every logement back', async () => {
  api.getFinanceDashboard.mockReset()
    .mockRejectedValueOnce({ error: 'Logement inconnu.' })
    .mockResolvedValue(DASHBOARD);
  renderAt('/finance?logement=999');
  expect(await screen.findByText('Logement inconnu.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tous les logements' }));
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenCalledTimes(2));
  expect(api.getFinanceDashboard.mock.calls[1][0]).toMatchObject({ propertyId: '' });
});
