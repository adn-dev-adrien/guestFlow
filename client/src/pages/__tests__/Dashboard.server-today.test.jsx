// specs/ds-sweep-planning.md rule 28 — the Dashboard's « today » is the server's date (the 30-day KPI
// window left with the tiles, specs/shell-and-home-day-first.md rule 2); the attention subjects —
// email readiness included — are only loaded for an admin (an accountant would get a 403).
// specs/upcoming-reservations-cards.md rule 7 — never the UTC date, which still read yesterday between
// midnight and 2 a.m. in Paris (review #8, n-1: « 17/10/2026 » shown at 01:54 on the 18th).
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';
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

const shownDate = () => screen.getAllByLabelText('Date affichée')[0].value;

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><Dashboard /></DialogProvider></ThemeProvider></MemoryRouter>,
);

beforeEach(() => {
  mockAuth.user = { roles: ['admin'] };
  api.getReservations.mockReset().mockResolvedValue([]);
  api.getAttention.mockReset().mockResolvedValue({
    pinned: [], total: 2, items: [{ key: 'email-readiness', severity: 'todo', count: 2, title: 'Emails incomplets', detail: '' }],
  });
  api.getReservation.mockReset().mockResolvedValue(null);
  api.getToday.mockReset().mockResolvedValue({ today: '2026-10-25' });
});
afterEach(() => { vi.useRealTimers(); });

test('specs/ds-sweep-planning.md rule 28: the Dashboard loads from the server date', async () => {
  renderPage();
  await waitFor(() => expect(api.getReservations).toHaveBeenCalledWith({ from: '2026-10-25' }));
  expect(api.getReservations).toHaveBeenCalledTimes(1);
  expect(screen.getAllByLabelText('Date affichée')[0]).toHaveValue('2026-10-25');
});

test('specs/ds-sweep-planning.md rule 28: nothing loads before the server date is known', async () => {
  let answer;
  api.getToday.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  renderPage();
  await new Promise((r) => setTimeout(r, 20));
  expect(api.getReservations).not.toHaveBeenCalled();
  answer({ today: '2026-03-29' });
  await waitFor(() => expect(api.getReservations).toHaveBeenCalledWith({ from: '2026-03-29' }));
});

test('specs/guest-email-texts-made-simple.md rule 7: the email readiness alert is an admin read — not loaded for an accountant', async () => {
  const admin = renderPage();
  expect(await screen.findByText('Emails incomplets')).toBeInTheDocument();
  admin.unmount();
  api.getAttention.mockClear();
  mockAuth.user = { roles: ['accountant'] };
  renderPage();
  await waitFor(() => expect(api.getReservations).toHaveBeenCalled());
  expect(api.getAttention).not.toHaveBeenCalled();
  expect(screen.queryByText('Emails incomplets')).not.toBeInTheDocument();
});

test('specs/upcoming-reservations-cards.md rule 7: at 01:54 in Paris, when the server cannot answer, the day is the 18th, not UTC\'s 17th', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-17T23:54:00Z'));
  api.getToday.mockRejectedValue(new Error('offline'));
  renderPage();
  // The browser's calendar day: the 18th wherever the clock reads Paris time (the CI runs both).
  if (process.env.TZ === 'Europe/Paris') expect(localIsoToday()).toBe('2026-10-18');
  await waitFor(() => expect(shownDate()).toBe(localIsoToday()));
});

test('specs/upcoming-reservations-cards.md rule 7: day arithmetic stays on the calendar across the October time change', () => {
  expect(addIsoDays('2026-10-24', 1)).toBe('2026-10-25');
  expect(addIsoDays('2026-10-25', 1)).toBe('2026-10-26');
  expect(addIsoDays('2026-10-18', 30)).toBe('2026-11-17');
  expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
});
