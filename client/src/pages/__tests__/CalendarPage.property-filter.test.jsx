// specs/ui-review-2026-10-19-operations.md rule 16 — a usable property filter: « Tous | A | B » as a
// segmented control with three logements or fewer, a select past that; « Tous » is the all-logements
// calendar.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getProperties: vi.fn(), getProperty: vi.fn().mockResolvedValue({ id: 1, name: 'Gite' }),
    getReservations: vi.fn().mockResolvedValue([]), getCalendarNotes: vi.fn().mockResolvedValue([]),
    getDevis: vi.fn().mockResolvedValue([]), getOccupiedDates: vi.fn().mockResolvedValue([]),
    getEstablishmentClosures: vi.fn().mockResolvedValue([]), getPublicHolidays: vi.fn().mockResolvedValue([]),
    upsertCalendarNote: vi.fn(), deleteCalendarNote: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ alert: vi.fn(), confirm: vi.fn() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useDayMarkers', () => ({ default: () => ({ markersFor: () => [], legend: [] }) }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import api from '../../api';
import CalendarPage from '../CalendarPage';

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><CalendarPage /></ThemeProvider></MemoryRouter>,
);

test('rule 16 — three logements or fewer: a segmented « Tous | Gite | Aventura lodge »', async () => {
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gite' }, { id: 2, name: 'Aventura lodge' }]);
  const user = userEvent.setup();
  renderPage();
  const groups = await screen.findAllByRole('group', { name: 'Logement' });
  const group = groups[0];
  await waitFor(() => expect(within(group).getByRole('button', { name: 'Aventura lodge' })).toBeInTheDocument());
  expect(within(group).getByRole('button', { name: 'Tous' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(within(group).getByRole('button', { name: 'Gite' }));
  await waitFor(() => expect(within(screen.getAllByRole('group', { name: 'Logement' })[0]).getByRole('button', { name: 'Gite' })).toHaveAttribute('aria-pressed', 'true'));
  await user.click(within(screen.getAllByRole('group', { name: 'Logement' })[0]).getByRole('button', { name: 'Tous' }));
  await waitFor(() => expect(within(screen.getAllByRole('group', { name: 'Logement' })[0]).getByRole('button', { name: 'Tous' })).toHaveAttribute('aria-pressed', 'true'));
});

test('rule 16 — more than three logements: a select with « Tous » first', async () => {
  api.getProperties.mockResolvedValue([1, 2, 3, 4].map((id) => ({ id, name: `Logement ${id}` })));
  renderPage();
  await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0));
  expect(screen.queryByRole('group', { name: 'Logement' })).toBeNull();
  expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Tous');
});
