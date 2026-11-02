// specs/finance-dashboard-redesign.md rule 51 + specs/reservations-backend-mvc.md rule 13, second reading (review
// of PR #938, F8 / V2) — a link to a custom window is judged from the server's day (`GET /api/today`), not the
// device's: a start the device would accept but the server would refuse keeps the period selector with the message.
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
import { PERIOD_MESSAGES } from '../../components/PeriodSelector';
import { horizonStart } from '../../utils/dateHorizon';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

beforeEach(() => {
  vi.clearAllMocks();
  api.getFinanceDashboard.mockReturnValue(new Promise(() => {}));
  api.getVatFranchise.mockResolvedValue({ applies: false });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('rule 51 — a window starting inside the device\'s window but before the server\'s shows the refusal', async () => {
  api.getToday.mockResolvedValue({ today: addIsoDays(localIsoToday(), 400) });
  const from = addIsoDays(horizonStart(localIsoToday()), 30);
  render(
    <MemoryRouter initialEntries={[`/finance?periode=custom&du=${from}&au=${addIsoDays(from, 30)}`]}>
      <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.tooOld);
  expect(screen.getByLabelText('Du')).toHaveValue(from);
});
