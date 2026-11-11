// specs/upcoming-reservations-cards.md rule 6 — « Réservations à venir » loads in ONE call, however many
// stays are booked: the page renders the server's days and never fetches a reservation on its own
// (review #8, m-9: ~350 calls per visit locked the app out behind the API rate limit).
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getUpcomingReservations: vi.fn(),
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
  },
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import api from '../../api';
import ReservationsUpcomingPage from '../ReservationsUpcomingPage';

const stay = (id, startDate, over = {}) => ({
  id, firstName: 'Client', lastName: `N${id}`, propertyName: 'Gite', platform: 'direct', startDate,
  endDate: '2099-01-09', checkInTime: '15:00', adults: 2, teens: 0, children: 0, babies: 0,
  options: [], resources: [], checkInReady: 0, ...over,
});

const MANY = Array.from({ length: 500 }, (_, i) => stay(i + 1, '2026-11-02'));

function payload(days) {
  return { today: '2026-10-18', days };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <ReservationsUpcomingPage />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

test('rule 6 — 500 booked stays: one request, no per-reservation fetch', async () => {
  api.getUpcomingReservations.mockResolvedValue(payload([
    { date: '2026-11-02', label: 'lundi 2 novembre', isToday: false, reservations: MANY, readyCount: 0, total: 500, allReady: false },
  ]));
  renderPage();
  // 500 cards take seconds to render in jsdom on a loaded machine: generous waits, same assertion.
  expect(await screen.findByText('N500', { exact: false }, { timeout: 20_000 })).toBeInTheDocument();
  expect(api.getUpcomingReservations).toHaveBeenCalledTimes(1);
  expect(api.getReservations).not.toHaveBeenCalled();
  expect(api.getReservation).not.toHaveBeenCalled();
}, 30_000);

test('rule 6 — the day header shows the server label, its « today » mark and its count as sent', async () => {
  api.getUpcomingReservations.mockResolvedValue(payload([
    { date: '2026-10-18', label: 'dimanche 18 octobre', isToday: true, reservations: [stay(1, '2026-10-18', { checkInReady: 1 }), stay(2, '2026-10-18')], readyCount: 1, total: 2, allReady: false },
  ]));
  renderPage();
  expect(await screen.findByText(/dimanche 18 octobre — Aujourd'hui/)).toBeInTheDocument();
  expect(screen.getByText('1/2')).toBeInTheDocument();
});

test('rule 6 — ticking « prêt » asks the server again instead of recounting', async () => {
  api.getUpcomingReservations
    .mockResolvedValueOnce(payload([{ date: '2026-11-02', label: 'lundi 2 novembre', isToday: false, reservations: [stay(1, '2026-11-02')], readyCount: 0, total: 1, allReady: false }]))
    .mockResolvedValueOnce(payload([{ date: '2026-11-02', label: 'lundi 2 novembre', isToday: false, reservations: [stay(1, '2026-11-02', { checkInReady: 1 })], readyCount: 1, total: 1, allReady: true }]));
  api.markPayment.mockResolvedValue({});
  renderPage();
  expect(await screen.findByText('0/1')).toBeInTheDocument();
  const card = screen.getByText('N1', { exact: false }).closest('.MuiCard-root');
  fireEvent.click(within(card).getByRole('checkbox'));
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(1, { checkInReady: true }));
  expect(await screen.findByText('1/1')).toBeInTheDocument();
  expect(api.getUpcomingReservations).toHaveBeenCalledTimes(2);
  expect(api.getUpcomingReservations).toHaveBeenLastCalledWith('2026-11-02');
});
