// specs/upcoming-reservations-cards.md rule 9 — the dashboard reloads on every day change: when an
// older load answers last, it must not paint over the newer one (review of PR #700, finding 4).
import { vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getToday: vi.fn(),
    getAttention: vi.fn(),
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import Dashboard from '../Dashboard';
import { addIsoDays } from '../../utils/isoDay';

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

test('rule 9 — a late answer for the day left behind does not replace the arrivals of the day shown', async () => {
  const server = '2026-10-25';
  const previous = addIsoDays(server, -1);
  const late = stay(1, 'Tardif', server);
  const fresh = stay(2, 'Actuel', previous);
  const slow = [];
  let clicked = false;
  api.getToday.mockResolvedValue({ today: server });
  api.getReservations.mockImplementation(({ from }) => {
    if (clicked) return Promise.resolve(from === previous ? [fresh] : []);
    const d = deferred();
    slow.push(d);
    return d.promise;
  });
  api.getReservation.mockImplementation((id) => Promise.resolve(id === 1 ? late : fresh));
  renderPage();
  await waitFor(() => expect(slow).toHaveLength(1));
  clicked = true;
  fireEvent.click(screen.getAllByLabelText('Jour précédent')[0]);
  expect((await screen.findAllByText(/Actuel/)).length).toBeGreaterThan(0);
  slow.forEach((d) => d.resolve([late]));
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByText(/Tardif/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Actuel/).length).toBeGreaterThan(0);
});
