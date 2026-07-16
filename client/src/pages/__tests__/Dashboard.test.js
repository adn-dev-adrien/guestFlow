import { vi } from 'vitest';
/**
 * Dashboard — DS phase-5 sweep (specs/ds-sweep-planning.md §7):
 *  - KPI tiles render through the « Maison » kpiLabel/kpiValue role variants;
 *  - a rejected loader surfaces the retryable ErrorAlert (the page used to swallow fetch errors
 *    with `loading` stuck on a bare LinearProgress);
 *  - the initial load shows the shared LoadingState.
 * Self-contained alert widgets + the cumulative calendar are stubbed out — each has its own suite.
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
    getProperties: vi.fn(),
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
  },
}));

// Self-contained dashboard widgets (each self-fetches; covered by their own suites).
vi.mock('../../components/LinenShortageAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalDateDriftAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalCancellationAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/IcalNewReservationsAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/EmailPendingAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/DevisPublicRequestAlert', () => ({ __esModule: true, default: () => null }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => <div>CUMULATIVE_CALENDAR</div> }));

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

beforeEach(() => {
  api.getProperties.mockReset().mockResolvedValue([{ id: 1, name: 'Gîte' }, { id: 2, name: 'Lodge' }]);
  api.getReservations.mockReset().mockResolvedValue([]);
  api.getReservation.mockReset().mockResolvedValue(null);
});

test('KPI tiles use the kpiLabel/kpiValue role variants (Logements count from the API)', async () => {
  renderPage();
  const label = await screen.findByText('Logements');
  // kpiLabel/kpiValue map to <p> (variantMapping) — NOT headings like the legacy h4 tiles.
  expect(label.tagName).toBe('P');
  const value = screen.getAllByText('2')[0];
  expect(value.tagName).toBe('P');
  expect(screen.getByText('Réservations (30j)')).toBeInTheDocument();
  expect(screen.getByText('Arrivées (date sélectionnée)')).toBeInTheDocument();
});

test('a rejected loader shows the retryable ErrorAlert instead of a stuck page', async () => {
  api.getProperties.mockRejectedValue(new Error('boom'));
  renderPage();
  expect(await screen.findByText('Impossible de charger le tableau de bord.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  // The KPI section is not rendered in the error state.
  expect(screen.queryByText('Logements')).not.toBeInTheDocument();
});

test('the initial load shows the shared LoadingState (aria-busy)', async () => {
  let resolveProps;
  api.getProperties.mockReturnValue(new Promise((resolve) => { resolveProps = resolve; }));
  renderPage();
  expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  resolveProps([]);
  await screen.findByText('Logements');
});
