// specs/non-card-option-served-persons.md rule 27 — the arrivals table prints the figure the server sends,
// not `quantity`, which stays 1 on a typed line.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getPlanningToday: vi.fn(), getAttention: vi.fn(), markPayment: vi.fn(), getToday: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));
vi.mock('../../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import api from '../../api';
import Dashboard from '../Dashboard';
import { localIsoToday } from '../../utils/isoDay';

test('rule 27 — a typed line reads the people served, a line without a figure keeps its quantity', async () => {
  const today = localIsoToday();
  api.getAttention.mockResolvedValue({ pinned: [], total: 0, items: [] });
  api.getToday.mockResolvedValue({ today });
  api.getPlanningToday.mockResolvedValue({
    today,
    departures: [],
    nextArrival: null,
    arrivals: [{
      id: 1, startDate: today, endDate: today, propertyName: 'Gite', firstName: 'Camille', lastName: 'Martin', resources: [],
      options: [
        { title: 'Linge', quantity: 1, displayCount: 3 },
        { title: 'Ménage', quantity: 2 },
      ],
    }],
  });
  render(<MemoryRouter><ThemeProvider theme={theme}><DialogProvider><Dashboard /></DialogProvider></ThemeProvider></MemoryRouter>);
  expect((await screen.findAllByText(/Linge x3, Ménage x2/)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Linge x1/)).not.toBeInTheDocument();
});
