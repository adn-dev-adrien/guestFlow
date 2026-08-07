import { vi } from 'vitest';
/**
 * ReservationsUpcomingPage — DS phase-5 sweep (specs/ds-sweep-planning.md §7):
 * a load FAILURE must surface the retryable ErrorAlert — the page used to swallow it into
 * « Aucune réservation à venir. » (failure disguised as an empty list).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
    getReservationSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
  },
}));

import api from '../../api';
import ReservationsUpcomingPage from '../ReservationsUpcomingPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <ReservationsUpcomingPage />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getReservations.mockReset();
  api.getReservation.mockReset();
});

test('a failed load shows the ErrorAlert with retry — NOT the empty state', async () => {
  api.getReservations.mockRejectedValue(new Error('down'));
  renderPage();
  expect(await screen.findByText('Impossible de charger les réservations à venir.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  expect(screen.queryByText('Aucune réservation à venir.')).not.toBeInTheDocument();
});

test('an actually-empty list shows the EmptyState (no error)', async () => {
  api.getReservations.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText('Aucune réservation à venir.')).toBeInTheDocument();
  expect(screen.queryByText('Impossible de charger les réservations à venir.')).not.toBeInTheDocument();
});
