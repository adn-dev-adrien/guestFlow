// specs/finance-dashboard-redesign.md rule 51, readings of 2026-11-02 (review of PR #937, R3) — a link to a
// custom window the server refuses (wider than 750 days, past the date horizon) sends nothing: the page shows
// the period selector with the message, so the operator fixes the window in place instead of a dead end.
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
import { horizonEnd } from '../../utils/dateHorizon';
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

const TODAY = localIsoToday();
const H = horizonEnd();

test.each([
  ['wider than 750 days', addIsoDays(TODAY, -800), TODAY, PERIOD_MESSAGES.tooWide, { field: 'Du', value: addIsoDays(TODAY, -30) }],
  ['past the horizon', addIsoDays(H, -30), addIsoDays(H, 1), PERIOD_MESSAGES.tooFar, { field: 'Au', value: H }],
])('a link to a window %s keeps the period selector, sends nothing, and loads once fixed', async (_name, from, to, message, fix) => {
  renderAt(`/finance?periode=custom&du=${from}&au=${to}`);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText('Au')).toHaveValue(to);
  expect(api.getFinanceDashboard).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(fix.field), { target: { value: fix.value } });
  await waitFor(() => expect(api.getFinanceDashboard).toHaveBeenCalledTimes(1));
  expect(api.getFinanceDashboard.mock.calls[0][0]).toMatchObject({ period: 'custom', ...(fix.field === 'Du' ? { from: fix.value, to } : { from, to: fix.value }) });
});
