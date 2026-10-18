// specs/upcoming-reservations-cards.md rule 7 — the dashboard opens on the server's calendar day, and
// until it answers on the browser's own calendar day: never on the UTC date, which still read
// yesterday between midnight and 2 a.m. in Paris (review #8, n-1: « 17/10/2026 » shown at 01:54 on the 18th).
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

const shownDate = () => screen.getAllByLabelText('Date affichée')[0].value;

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([]);
  api.getReservations.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

test('rule 7 — the day shown is the one the server answers', async () => {
  api.getToday.mockResolvedValue({ today: '2026-12-25' });
  renderPage();
  await waitFor(() => expect(shownDate()).toBe('2026-12-25'));
  await waitFor(() => expect(api.getReservations).toHaveBeenCalledWith({ from: '2026-12-25', to: '2027-01-24' }));
});

test('rule 7 — at 01:54 in Paris, before the server answers, the day is the 18th, not UTC\'s 17th', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-17T23:54:00Z'));
  api.getToday.mockReturnValue(new Promise(() => {}));
  renderPage();
  // The browser's calendar day: the 18th wherever the clock reads Paris time (the CI runs both).
  if (process.env.TZ === 'Europe/Paris') expect(localIsoDate()).toBe('2026-10-18');
  await waitFor(() => expect(shownDate()).toBe(localIsoDate()));
});

test('rule 7 — day arithmetic stays on the calendar across the October time change', () => {
  expect(addIsoDays('2026-10-24', 1)).toBe('2026-10-25');
  expect(addIsoDays('2026-10-25', 1)).toBe('2026-10-26');
  expect(addIsoDays('2026-10-18', 30)).toBe('2026-11-17');
  expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
});
