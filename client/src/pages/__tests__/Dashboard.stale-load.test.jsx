// specs/upcoming-reservations-cards.md rule 9 — the dashboard loads the browser's day, then the
// server's (rule 7): when the first load answers last, it must not paint over the second (review of
// PR #700, finding 4).
import { vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getToday: vi.fn(),
    getProperties: vi.fn(),
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));
vi.mock('../../plugins/linen/LinenShortageAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalDateDriftAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalCancellationAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/NewReservationsAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/EmailPendingAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/EmailReadinessAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/TwoFactorNudgeCard', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import Dashboard from '../Dashboard';
import { addIsoDays, localIsoDate } from '../../utils/localDate';

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <Dashboard />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

const stay = (id, lastName, startDate) => ({
  id, firstName: 'Client', lastName, propertyName: 'Gite', platform: 'direct', startDate, endDate: '2099-01-09',
  checkInTime: '15:00', adults: 2, teens: 0, children: 0, babies: 0, options: [], resources: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([]);
});

test('rule 9 — a late answer for the browser\'s day does not replace the server day\'s arrivals', async () => {
  const local = localIsoDate();
  const server = addIsoDays(local, 1);
  const late = stay(1, 'Tardif', local);
  const fresh = stay(2, 'Actuel', server);
  const slow = [];
  api.getToday.mockResolvedValue({ today: server });
  api.getReservations.mockImplementation(({ from }) => {
    if (from !== local) return Promise.resolve([fresh]);
    const d = deferred();
    slow.push(d);
    return d.promise;
  });
  api.getReservation.mockImplementation((id) => Promise.resolve(id === 1 ? late : fresh));
  renderPage();
  expect((await screen.findAllByText(/Actuel/)).length).toBeGreaterThan(0);
  expect(slow).toHaveLength(2);
  slow.forEach((d) => d.resolve([late]));
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByText(/Tardif/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Actuel/).length).toBeGreaterThan(0);
});
