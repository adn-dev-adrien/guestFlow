// specs/calendar-property-parity.md rules 14-15 — the logement calendar has no month arrows (« Aujourd'hui »
// is the only navigation), and switching logement empties the cache but opens on the month that was in view.
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
    getProperties: vi.fn().mockResolvedValue([{ id: 1, name: 'Gite' }, { id: 2, name: 'Aventura lodge' }]),
    getProperty: vi.fn().mockResolvedValue({ id: 1, name: 'Gite', cleaningHours: 3 }),
    getCalendar: vi.fn().mockResolvedValue({ from: '2026-03-01', to: '2026-03-31', today: '2026-03-15', stays: [], closures: [] }),
    getCalendarNotes: vi.fn().mockResolvedValue([]), getDevis: vi.fn().mockResolvedValue([]),
    getOccupiedDates: vi.fn().mockResolvedValue([]), getPublicHolidays: vi.fn().mockResolvedValue([]),
    upsertCalendarNote: vi.fn(), deleteCalendarNote: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ alert: vi.fn(), confirm: vi.fn() }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useDayMarkers', () => ({ default: () => ({ markersFor: () => [], legend: [] }) }));
vi.mock('../../hooks/useServerToday', () => ({ default: () => '2026-03-15' }));

import api from '../../api';
import CalendarPage from '../CalendarPage';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/calendar?propertyId=1&year=2026&month=2']}>
    <ThemeProvider theme={theme}><CalendarPage /></ThemeProvider>
  </MemoryRouter>,
);

test('rule 14 — no « Mois précédent / Mois suivant » on a logement, only « Aujourd\'hui »', async () => {
  renderPage();
  expect(await screen.findByRole('button', { name: /Aujourd'hui/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Mois (précédent|suivant)/ })).toBeNull();
});

test('rule 15 — each month of the logement is read once from the shared calendar endpoint', async () => {
  renderPage();
  await waitFor(() => expect(api.getCalendar).toHaveBeenCalled());
  const calls = api.getCalendar.mock.calls.map(([q]) => `${q.propertyId}:${q.from}`);
  expect(new Set(calls).size).toBe(calls.length);
  expect(api.getCalendar.mock.calls[0][0]).toMatchObject({ propertyId: 1 });
});

test('rule 15 — switching logement reads the same months for the other logement', async () => {
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(api.getCalendar).toHaveBeenCalled());
  const fromsBefore = new Set(api.getCalendar.mock.calls.map(([q]) => q.from));
  api.getCalendar.mockClear();
  const group = (await screen.findAllByRole('group', { name: 'Logement' }))[0];
  await user.click(within(group).getByRole('button', { name: 'Aventura lodge' }));
  await waitFor(() => expect(api.getCalendar.mock.calls.some(([q]) => q.propertyId === 2)).toBe(true));
  const march = api.getCalendar.mock.calls.find(([q]) => q.propertyId === 2 && fromsBefore.has(q.from));
  expect(march).toBeTruthy();
});
