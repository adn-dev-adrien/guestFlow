// specs/shell-and-home-day-first.md rules 1–3, 11, 19 — the home shows the day first: pinned subjects,
// departures, arrivals, then « À traiter »; no KPI tile; counts re-read after a write. (Rule 19, the
// date cluster, is superseded by specs/dashboard-planning-scroll.md rule 6.)
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import { DATA_CHANGED_EVENT } from '../../constants/appEvents';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getToday: vi.fn(),
    getProperties: vi.fn(),
    getPlanningToday: vi.fn(),
    getAttention: vi.fn(),
    markPayment: vi.fn(),
  },
}));
const { mockAuth } = vi.hoisted(() => ({ mockAuth: { user: { roles: ['admin'], enabledPlugins: [] } } }));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => mockAuth }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => <div>CUMULATIVE_CALENDAR</div> }));
vi.mock('../../components/attentionSubjects', () => ({
  CORE_ATTENTION_SUBJECTS: { 'payment-deadlines': () => <div>PINNED_PAYMENTS</div> },
}));

import api from '../../api';
import Dashboard from '../Dashboard';

const ATTENTION = {
  pinned: [{ key: 'payment-deadlines', severity: 'urgent', count: 2, title: 'Échéances de paiement', detail: '2 en retard' }],
  items: [{ key: 'email-pending', severity: 'info', count: 3, title: 'Emails à vérifier', detail: '3 messages à envoyer' }],
  total: 3,
};

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><Dashboard /></DialogProvider></ThemeProvider></MemoryRouter>,
);
const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { roles: ['admin'], enabledPlugins: [] };
  api.getToday.mockResolvedValue({ today: '2026-10-19' });
  api.getPlanningToday.mockResolvedValue({ today: '2026-10-19', departures: [], arrivals: [], nextArrival: null });
  api.getAttention.mockResolvedValue(ATTENTION);
});

test('rule 1: pinned → Départs → Arrivées → « À traiter » → calendar', async () => {
  renderPage();
  const pinned = await screen.findByText('PINNED_PAYMENTS');
  const departures = await screen.findByText('Départs du jour');
  const arrivals = screen.getByText('Arrivées du jour');
  const inbox = await screen.findByRole('heading', { name: 'À traiter' });
  const calendar = screen.getByText('CUMULATIVE_CALENDAR');
  expect(follows(pinned, departures)).toBe(true);
  expect(follows(departures, arrivals)).toBe(true);
  expect(follows(arrivals, inbox)).toBe(true);
  expect(follows(inbox, calendar)).toBe(true);
  expect(screen.getByTestId('attention-total')).toHaveTextContent('3');
});

test('rule 2: no KPI tile, and the home no longer loads the properties nor the 30-day list for them', async () => {
  renderPage();
  await screen.findByText('Départs du jour');
  expect(screen.queryByText('Logements')).not.toBeInTheDocument();
  expect(screen.queryByText('Réservations (30j)')).not.toBeInTheDocument();
  expect(screen.queryByText('Arrivées (date sélectionnée)')).not.toBeInTheDocument();
  expect(api.getProperties).not.toHaveBeenCalled();
  expect(api.getPlanningToday).toHaveBeenCalledTimes(1);
});

test('rule 11: a write anywhere makes the home read its counts again', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'À traiter' });
  expect(api.getAttention).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
  await waitFor(() => expect(api.getAttention).toHaveBeenCalledTimes(2));
});
