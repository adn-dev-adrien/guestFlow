// specs/bed-config-in-linen-card.md rule 11 (audit 2026-10-27) — a stay without any bed count (no
// bed-linen option: the server zeroes them, rule 7) shows no « Lits : D:0 / S:0 / B:0 ».
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getReservations: vi.fn(),
    getAttention: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
    getToday: vi.fn(),
  },
}));
const { mockAuth } = vi.hoisted(() => ({ mockAuth: { user: { roles: ['admin'] } } }));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => mockAuth }));
vi.mock('../../plugins/linen/LinenShortageAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalDateDriftAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalCancellationAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/NewReservationsAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/EmailPendingAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/EmailReadinessAlert', () => ({ __esModule: true, default: () => <div>EMAIL_READINESS</div> }));
vi.mock('../../components/TwoFactorNudgeCard', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/CancellationCompensationsPendingAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/PaymentDeadlinesAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/UpdateAvailableAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import Dashboard from '../Dashboard';

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><Dashboard /></DialogProvider></ThemeProvider></MemoryRouter>,
);

const STAY = { id: 1, startDate: '2026-10-25', endDate: '2026-10-27', propertyName: 'Gite', firstName: 'Camille', lastName: 'Martin', options: [], resources: [] };

beforeEach(() => {
  mockAuth.user = { roles: ['admin'] };
  api.getAttention.mockReset().mockResolvedValue({ pinned: [], total: 0, items: [] });
  api.getToday.mockReset().mockResolvedValue({ today: '2026-10-25' });
});

test('rule 11: no bed count → « — » in the arrivals table, no « Lits » line', async () => {
  api.getReservations.mockReset().mockResolvedValue([STAY]);
  api.getReservation.mockReset().mockResolvedValue({ ...STAY, doubleBeds: 0, singleBeds: 0, babyBeds: 0 });
  renderPage();
  await waitFor(() => expect(screen.getAllByText('Camille Martin').length).toBeGreaterThan(0));
  expect(screen.queryByText(/D:0 \/ S:0/)).not.toBeInTheDocument();
});

test('rule 11: a stay with beds still shows them', async () => {
  api.getReservations.mockReset().mockResolvedValue([STAY]);
  api.getReservation.mockReset().mockResolvedValue({ ...STAY, doubleBeds: 1, singleBeds: 2, babyBeds: 0 });
  renderPage();
  expect((await screen.findAllByText(/D:1 \/ S:2 \/ B:0/)).length).toBeGreaterThan(0);
});
