import { vi } from 'vitest';
/**
 * Dashboard — DS phase-5 sweep (specs/ds-sweep-planning.md §7):
 *  - (the KPI tiles left the home on 2026-10-19 — specs/shell-and-home-day-first.md rule 2, covered
 *    by Dashboard.day-first.test.jsx);
 *  - a rejected loader surfaces the retryable ErrorAlert (the page used to swallow fetch errors
 *    with `loading` stuck on a bare LinearProgress);
 *  - the initial load shows the shared LoadingState.
 * Self-contained alert widgets + the cumulative calendar are stubbed out — each has its own suite.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPlanningToday: vi.fn(),
    getAttention: vi.fn(),
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
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

// The cumulative calendar has its own suite.
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => <div>CUMULATIVE_CALENDAR</div> }));

import api from '../../api';
import Dashboard from '../Dashboard';
import { localIsoToday } from '../../utils/isoDay';

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <Dashboard />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

// What GET /api/planning/today answers (specs/dashboard-planning-scroll.md rule 1).
const dayLists = ({ arrivals = [], departures = [], nextArrival = null } = {}) => ({
  today: localIsoToday(), arrivals, departures, nextArrival,
});

beforeEach(() => {
  mockAuth.user = { roles: ['admin'] };
  navigateSpy.mockReset();
  api.getPlanningToday.mockReset().mockResolvedValue(dayLists());
  api.getAttention.mockReset().mockResolvedValue({ pinned: [], items: [], total: 0 });
});

test('a rejected loader shows the retryable ErrorAlert instead of a stuck page', async () => {
  api.getPlanningToday.mockRejectedValue(new Error('boom'));
  renderPage();
  expect(await screen.findByText('Impossible de charger le tableau de bord.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  // The day lists are not rendered in the error state.
  expect(screen.queryByText('Départs du jour')).not.toBeInTheDocument();
});

test('the initial load shows the shared LoadingState (aria-busy)', async () => {
  let resolveList;
  api.getPlanningToday.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
  renderPage();
  expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  resolveList(dayLists());
  await screen.findByText('Départs du jour');
});

// specs/dashboard-collection-alert.md §3 — the « Paiements » cell must only go red on money to
// collect at the door. A platform booking waiting for its post-stay payout used to be red daily.
describe('« Paiements » column (specs/dashboard-collection-alert.md)', () => {
  const today = localIsoToday();
  const base = {
    id: 7, startDate: today, endDate: '2099-12-31', checkInTime: '16:00',
    firstName: 'Luc', lastName: 'Martin', propertyName: 'Gîte du Lac',
    cautionAmount: 0, options: [], resources: [],
    doubleBeds: 1, singleBeds: 0, babyBeds: 0,
  };

  function mountArrival(operationalCollection) {
    api.getPlanningToday.mockReset().mockResolvedValue(dayLists({ arrivals: [{ ...base, operationalCollection }] }));
    return renderPage();
  }

  test('a platform booking awaiting its payout shows no red and explains why', async () => {
    mountArrival({
      arrival: { alert: false, settled: false, amountDue: 0, deferred: false, parts: [{ key: 'balance', label: 'Solde', state: 'pending' }] },
      departure: { alert: false, settled: false, amountDue: 0, deferred: false, parts: [] },
      platformSettled: true,
      platform: 'Airbnb',
    });
    const detail = await screen.findByText('Solde dû');
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
    expect(screen.getByText('Solde dû · Complément dû')).toBeInTheDocument();
  });

  // specs/ds-components.md rule 25 — « Lit bébé ×1 », accent and multiplication sign included.
  test('a baby bed reads « Lit bébé ×1 »', async () => {
    api.getPlanningToday.mockReset().mockResolvedValue(dayLists({ arrivals: [{ ...base, babyBeds: 1 }] }));
    renderPage();
    expect((await screen.findAllByText(/Lit bébé ×1/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Lit bebe/)).not.toBeInTheDocument();
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
  const today = localIsoToday();
  const arrival = {
    id: 42, startDate: today, endDate: '2099-12-31', checkInTime: '16:00',
    firstName: 'Marie', lastName: 'Durand', propertyName: 'Gîte du Lac',
    cautionAmount: 300, cautionReceived: 0, options: [], resources: [],
    doubleBeds: 1, singleBeds: 0, babyBeds: 0,
  };

  beforeEach(() => {
    mockAuth.user = { roles: ['reception'], enabledPlugins: ['sas'] };
    api.getPlanningToday.mockReset().mockResolvedValue(dayLists({ arrivals: [arrival] }));
  });

  test('shows the arrivals list but drops the attention subjects, the Paiements column and the month calendar', async () => {
    renderPage();
    await screen.findByText('Marie Durand');
    // Caution column stays (door money the reception collects).
    expect(screen.getByText('Caution')).toBeInTheDocument();
    // Finance + admin chrome are gone — no « À traiter », not even a call for it.
    expect(screen.queryByText('À traiter')).not.toBeInTheDocument();
    expect(api.getAttention).not.toHaveBeenCalled();
    expect(screen.queryByText('Paiements')).not.toBeInTheDocument();
    expect(screen.queryByText('CUMULATIVE_CALENDAR')).not.toBeInTheDocument();
  });

  test('tapping an arrival row opens the arrival SAS on the Planning via the deep-link', async () => {
    renderPage();
    const nameCell = await screen.findByText('Marie Durand');
    nameCell.closest('tr').click();
    expect(navigateSpy).toHaveBeenCalledWith('/planning?sas=arrival&reservationId=42');
  });

  test('without the SAS (outside the plan, failed) a row leads nowhere, and the notice says so', async () => {
    mockAuth.user = { roles: ['reception'], enabledPlugins: [] };
    renderPage();
    const nameCell = await screen.findByText('Marie Durand');
    nameCell.closest('tr').click();
    expect(navigateSpy).not.toHaveBeenCalledWith('/planning?sas=arrival&reservationId=42');
    expect(screen.getByText('Arrivées et départs guidés indisponibles pour le moment.')).toBeInTheDocument();
  });
});

test('the day lists run departures FIRST, arrivals second (issue #427)', async () => {
  // specs/reception-role-checkin-only.md §3.3 / §6.1 — the day is handled in that order (departures
  // in the morning, arrivals in the afternoon), so the first list is the one needed first.
  renderPage();
  const departures = await screen.findByText('Départs du jour');
  const arrivals = await screen.findByText('Arrivées du jour');
  // Node.compareDocumentPosition: 4 = arrivals FOLLOWS departures in the document.
  expect(departures.compareDocumentPosition(arrivals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
