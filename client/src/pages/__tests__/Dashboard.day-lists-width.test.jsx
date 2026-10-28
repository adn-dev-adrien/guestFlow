// specs/shell-and-home-day-first.md rule 25 — the home's day lists never hide a column: Départs and
// Arrivées switch to their cards TOGETHER as soon as their container cannot hold the arrivals table
// (940 px), whatever the viewport.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getPlanningToday: vi.fn(), getAttention: vi.fn(), markPayment: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => <div>CUMULATIVE_CALENDAR</div> }));

import api from '../../api';
import Dashboard from '../Dashboard';

const row = (id) => ({
  id, startDate: '2026-10-19', endDate: '2026-10-21', checkInTime: '16:00', checkOutTime: '10:00',
  firstName: 'Luc', lastName: 'Martin', propertyName: 'Gîte du Lac',
  cautionAmount: 0, options: [], resources: [], doubleBeds: 1, singleBeds: 0, babyBeds: 0,
});

const withWidth = (width) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  .mockReturnValue({ width, height: 100, top: 0, left: 0, right: width, bottom: 100, x: 0, y: 0 });

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><Dashboard /></DialogProvider></ThemeProvider></MemoryRouter>,
);

beforeEach(() => {
  api.getPlanningToday.mockReset().mockResolvedValue({
    today: '2026-10-19', arrivals: [row(1)], departures: [row(2)], nextArrival: null,
  });
  api.getAttention.mockReset().mockResolvedValue({ pinned: [], items: [], total: 0 });
});
afterEach(() => vi.restoreAllMocks());

test('a container narrower than 940 px shows both day lists as cards, never a table', async () => {
  withWidth(900);
  renderPage();
  await screen.findByText('Arrivées du jour');
  expect(document.querySelectorAll('table')).toHaveLength(0);
});

test('a container wide enough shows both day lists as tables', async () => {
  withWidth(1100);
  renderPage();
  await screen.findByText('Arrivées du jour');
  expect(document.querySelectorAll('table')).toHaveLength(2);
});
