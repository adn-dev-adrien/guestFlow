// specs/establishment-closures.md rule 20 (review of PR #937, R1) — the occupied-dates `to` is exclusive: the
// calendar asks for one month grid up to the day after its last cell, so a closure on the grid's last Sunday
// still stops the drag-select.
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getProperties: vi.fn().mockResolvedValue([{ id: 2, name: 'Lodge' }]), getProperty: vi.fn().mockResolvedValue({ id: 2, name: 'Lodge' }),
    getCalendar: vi.fn(async ({ from, to }) => ({ from, to, stays: [], closures: [] })), getCalendarNotes: vi.fn().mockResolvedValue([]),
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
import { monthGridRange } from '../../utils/calendarLayout';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

// The next month, a year or more ahead, whose last day is a Sunday: its grid ends on that day.
function monthEndingOnSunday() {
  const today = localIsoToday();
  for (let m = 12; m < 48; m += 1) {
    const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + m + 1, 0));
    if (last.getUTCDay() === 0) return { year: last.getUTCFullYear(), month: last.getUTCMonth(), last: last.toISOString().slice(0, 10) };
  }
  throw new Error('no month ending on a Sunday');
}

test('rule 20 — the month grid asks the occupied dates up to the day after its last Sunday', async () => {
  const { year, month, last } = monthEndingOnSunday();
  const { from, to } = monthGridRange(year, month);
  expect(to).toBe(last);
  render(
    <MemoryRouter initialEntries={[`/calendar?propertyId=2&year=${year}&month=${month}`]}>
      <ThemeProvider theme={theme}><CalendarPage /></ThemeProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.getOccupiedDates).toHaveBeenCalledWith(2, from, addIsoDays(last, 1)));
});
