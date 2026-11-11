// specs/dashboard-planning-scroll.md rules 1, 4, 5, 6 — the home asks the server once for the day, folds an
// empty list to one line, and shows the next arrival (date, distance, compact rows) when nobody arrives.
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getToday: vi.fn(),
    getPlanningToday: vi.fn(),
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    getAttention: vi.fn(),
    markPayment: vi.fn(),
  },
}));
const { mockAuth, navigateSpy } = vi.hoisted(() => ({
  mockAuth: { user: { roles: ['admin'], enabledPlugins: [] } },
  navigateSpy: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => mockAuth }));
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigateSpy }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import Dashboard from '../Dashboard';

const stay = (id, extra = {}) => ({
  id, startDate: '2026-11-06', endDate: '2026-11-09', checkInTime: '16:00', propertyName: 'La Granja',
  firstName: 'Camille', lastName: `Client${id}`, doubleBeds: 1, singleBeds: 0, babyBeds: 0, options: [], resources: [], ...extra,
});
const NEXT = (reservations) => ({ date: '2026-11-06', label: 'vendredi 6 novembre', relativeLabel: 'dans 9 jours', reservations });
const lists = (extra = {}) => ({ today: '2026-10-28', departures: [], arrivals: [], nextArrival: null, ...extra });

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><Dashboard /></DialogProvider></ThemeProvider></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { roles: ['admin'], enabledPlugins: [] };
  api.getToday.mockResolvedValue({ today: '2026-10-28' });
  api.getAttention.mockResolvedValue({ pinned: [], items: [], total: 0 });
});

test('rule 1 — the lists come from one getPlanningToday, no reservation request at all', async () => {
  api.getPlanningToday.mockResolvedValue(lists());
  renderPage();
  await screen.findByText('Départs du jour');
  expect(api.getPlanningToday).toHaveBeenCalledTimes(1);
  expect(api.getReservations).not.toHaveBeenCalled();
  expect(api.getReservation).not.toHaveBeenCalled();
});

test('rule 4 — an empty list folds to its title and one muted line, with no table and no card', async () => {
  api.getPlanningToday.mockResolvedValue(lists());
  renderPage();
  await screen.findByText("Aucun départ aujourd'hui");
  const folded = screen.getAllByTestId('folded-day-list');
  expect(folded).toHaveLength(2);
  expect(within(folded[0]).getByText('Départs du jour')).toBeInTheDocument();
  expect(within(folded[1]).getByText('Arrivées du jour')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('Aucun départ ce jour.')).not.toBeInTheDocument();
});

test('rule 4 — a non-empty list renders as before: its title and its table, not the folded line', async () => {
  api.getPlanningToday.mockResolvedValue(lists({ departures: [stay(1, { endDate: '2026-10-28', checkOutTime: '10:00' })] }));
  renderPage();
  expect((await screen.findAllByText('Client1', { exact: false })).length).toBeGreaterThan(0);
  expect(screen.queryByText("Aucun départ aujourd'hui")).not.toBeInTheDocument();
  expect(screen.getByText("Aucune arrivée aujourd'hui · aucune arrivée prévue")).toBeInTheDocument();
});

test('rule 5 — the next arrival shows its date large, its distance in a chip and one compact row per stay', async () => {
  api.getPlanningToday.mockResolvedValue(lists({
    nextArrival: NEXT([stay(1, { checkInTime: '15:00' }), stay(2, { checkInTime: null, doubleBeds: 0 })]),
  }));
  renderPage();
  const block = await screen.findByTestId('next-arrival');
  expect(within(block).getByText('Prochaine arrivée')).toBeInTheDocument();
  expect(within(block).getByText('vendredi 6 novembre')).toBeInTheDocument();
  expect(within(block).getByText('dans 9 jours')).toBeInTheDocument();
  const rows = within(block).getAllByTestId('next-arrival-row');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('15:00');
  expect(rows[0]).toHaveTextContent('La Granja');
  expect(rows[0]).toHaveTextContent('Camille Client1');
  expect(rows[0]).toHaveTextContent('Lits D:1 / S:0 / B:0');
  // The hour defaults to 15:00 and a stay without any bed says nothing about beds.
  expect(rows[1]).toHaveTextContent('15:00');
  expect(rows[1]).not.toHaveTextContent('Lits');
  expect(screen.getByText("Aucune arrivée aujourd'hui")).toBeInTheDocument();
  expect(screen.queryByText(/aucune arrivée prévue/)).not.toBeInTheDocument();
});

test('rule 5 — no « Prêt » / « Arrivé » check box on the next-arrival rows; an admin row opens the fiche', async () => {
  api.getPlanningToday.mockResolvedValue(lists({ nextArrival: NEXT([stay(7)]) }));
  renderPage();
  const block = await screen.findByTestId('next-arrival');
  expect(within(block).queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(within(block).getByTestId('next-arrival-row'));
  expect(navigateSpy).toHaveBeenCalledTimes(1);
  expect(navigateSpy.mock.calls[0][0]).toMatch(/^\/reservations\/7/);
});

test('rule 5 — for a reception account the next-arrival rows are inert', async () => {
  mockAuth.user = { roles: ['reception'], enabledPlugins: ['sas'] };
  api.getPlanningToday.mockResolvedValue(lists({ nextArrival: NEXT([stay(7)]) }));
  renderPage();
  const row = await screen.findByTestId('next-arrival-row');
  expect(row).not.toHaveAttribute('role', 'button');
  fireEvent.click(row);
  expect(navigateSpy).not.toHaveBeenCalled();
});

test('rule 5 — nothing arrives today nor later: the folded line says « aucune arrivée prévue »', async () => {
  api.getPlanningToday.mockResolvedValue(lists());
  renderPage();
  expect(await screen.findByText("Aucune arrivée aujourd'hui · aucune arrivée prévue")).toBeInTheDocument();
  expect(screen.queryByTestId('next-arrival')).not.toBeInTheDocument();
});

test('rule 6 — no date in the page bar: no input, no arrows, no « Aujourd\'hui », no « — date » in the titles', async () => {
  api.getPlanningToday.mockResolvedValue(lists());
  renderPage();
  await screen.findByText('Départs du jour');
  expect(screen.queryByLabelText('Date affichée')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Jour précédent')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Jour suivant')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: "Aujourd'hui" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Départs — /)).not.toBeInTheDocument();
  expect(screen.queryByText(/Arrivées — /)).not.toBeInTheDocument();
});

test('rule 7 — the lists load again when the server\'s day moves on', async () => {
  api.getPlanningToday.mockResolvedValue(lists());
  api.getToday.mockResolvedValueOnce({ today: '2026-10-28' }).mockResolvedValue({ today: '2026-10-29' });
  renderPage();
  await screen.findByText('Départs du jour');
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(api.getPlanningToday).toHaveBeenCalledTimes(2));
});
