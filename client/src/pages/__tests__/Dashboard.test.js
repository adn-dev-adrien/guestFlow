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

// specs/reception-role-checkin-only.md — Dashboard branches on the current user's roles. Mock the
// auth hook (mutable so a test can flip to a reception-only session).
const { mockAuth, navigateSpy } = vi.hoisted(() => ({
  mockAuth: { user: { roles: ['admin'] } },
  navigateSpy: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => mockAuth }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

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
  mockAuth.user = { roles: ['admin'] };
  navigateSpy.mockReset();
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

// specs/dashboard-collection-alert.md §3 — the « Paiements » cell must only go red on money to
// collect at the door. A platform booking waiting for its post-stay payout used to be red daily.
describe('« Paiements » column (specs/dashboard-collection-alert.md)', () => {
  const today = new Date().toISOString().split('T')[0];
  const base = {
    id: 7, startDate: today, endDate: '2099-12-31', checkInTime: '16:00',
    firstName: 'Luc', lastName: 'Martin', propertyName: 'Gîte du Lac',
    cautionAmount: 0, options: [], resources: [],
    doubleBeds: 1, singleBeds: 0, babyBeds: 0,
  };

  function mountArrival(operationalCollection) {
    api.getReservations.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([base]);
    api.getReservation.mockReset().mockResolvedValue({ ...base, operationalCollection });
    return renderPage();
  }

  test('a platform booking awaiting its payout shows no red and explains why', async () => {
    mountArrival({
      arrival: { alert: false, settled: false, amountDue: 0, deferred: false, parts: [{ key: 'balance', label: 'Solde', state: 'pending' }] },
      departure: { alert: false, settled: false, amountDue: 0, deferred: false, parts: [] },
      platformSettled: true,
      platform: 'Airbnb',
    });
    const detail = await screen.findByText('Solde NON');
    expect(detail).toBeInTheDocument();
    expect(screen.getByText('Réglé par la plateforme')).toBeInTheDocument();
    expect(screen.queryByText(/Complément à encaisser/)).not.toBeInTheDocument();
  });

  test('an unpaid arrival complement shows the red amount to collect', async () => {
    mountArrival({
      arrival: {
        alert: true, settled: false, amountDue: 45, deferred: false,
        parts: [{ key: 'balance', label: 'Solde', state: 'pending' }, { key: 'complement', label: 'Complément', state: 'pending' }],
      },
      departure: { alert: true, settled: false, amountDue: 45, deferred: false, parts: [] },
      platformSettled: true,
      platform: 'Airbnb',
    });
    expect(await screen.findByText(/Complément à encaisser/)).toBeInTheDocument();
    expect(screen.getByText('Solde NON · Complément NON')).toBeInTheDocument();
  });

  test('a fully settled reservation shows the plain green OK', async () => {
    mountArrival({
      arrival: { alert: false, settled: true, amountDue: 0, deferred: false, parts: [{ key: 'balance', label: 'Solde', state: 'ok' }] },
      departure: { alert: false, settled: true, amountDue: 0, deferred: false, parts: [] },
      platformSettled: false,
      platform: null,
    });
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(screen.queryByText('Solde OK')).not.toBeInTheDocument();
    expect(screen.queryByText('Réglé par la plateforme')).not.toBeInTheDocument();
  });
});

describe('reception-only home (specs/reception-role-checkin-only.md §3.3)', () => {
  const today = new Date().toISOString().split('T')[0];
  const arrival = {
    id: 42, startDate: today, endDate: '2099-12-31', checkInTime: '16:00',
    firstName: 'Marie', lastName: 'Durand', propertyName: 'Gîte du Lac',
    cautionAmount: 300, cautionReceived: 0, options: [], resources: [],
    doubleBeds: 1, singleBeds: 0, babyBeds: 0,
  };

  beforeEach(() => {
    mockAuth.user = { roles: ['reception'] };
    api.getReservations.mockReset()
      .mockResolvedValueOnce([])          // 30-day window (KPI count — unused for reception)
      .mockResolvedValueOnce([arrival]);  // upcoming (drives arrivals/departures)
    api.getReservation.mockReset().mockResolvedValue(arrival);
  });

  test('shows the arrivals list but drops KPI tiles, the Paiements column and the month calendar', async () => {
    renderPage();
    await screen.findByText('Marie Durand');
    // Caution column stays (door money the reception collects).
    expect(screen.getByText('Caution')).toBeInTheDocument();
    // Finance + admin chrome are gone.
    expect(screen.queryByText('Logements')).not.toBeInTheDocument();
    expect(screen.queryByText('Paiements')).not.toBeInTheDocument();
    expect(screen.queryByText('CUMULATIVE_CALENDAR')).not.toBeInTheDocument();
  });

  test('tapping an arrival row opens the arrival SAS on the Planning via the deep-link', async () => {
    renderPage();
    const nameCell = await screen.findByText('Marie Durand');
    nameCell.closest('tr').click();
    expect(navigateSpy).toHaveBeenCalledWith('/planning?sas=arrival&reservationId=42');
  });
});
