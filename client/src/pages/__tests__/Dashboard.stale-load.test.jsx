// specs/upcoming-reservations-cards.md rule 9 (kept for the server day moving on, specs/dashboard-planning-
// scroll.md rule 7) — when an older load answers last, it must not paint over the newer one.
import { vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getToday: vi.fn(),
    getAttention: vi.fn(),
    getPlanningToday: vi.fn(),
    markPayment: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import Dashboard from '../Dashboard';

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
  api.getAttention.mockResolvedValue({ pinned: [], items: [], total: 0 });
});

test('rule 9 — a late answer for the day left behind does not replace the lists of the day shown', async () => {
  const slow = deferred();
  api.getToday.mockResolvedValueOnce({ today: '2026-10-25' }).mockResolvedValue({ today: '2026-10-26' });
  api.getPlanningToday
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValue({ today: '2026-10-26', departures: [], arrivals: [stay(2, 'Actuel', '2026-10-26')], nextArrival: null });
  renderPage();
  await vi.waitFor(() => expect(api.getPlanningToday).toHaveBeenCalledTimes(1));
  // The page comes back to the foreground after midnight: the server's day moved on.
  window.dispatchEvent(new Event('focus'));
  expect((await screen.findAllByText(/Actuel/)).length).toBeGreaterThan(0);
  slow.resolve({ today: '2026-10-25', departures: [], arrivals: [stay(1, 'Tardif', '2026-10-25')], nextArrival: null });
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByText(/Tardif/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Actuel/).length).toBeGreaterThan(0);
});
