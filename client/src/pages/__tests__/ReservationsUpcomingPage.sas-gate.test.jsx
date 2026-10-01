// specs/plugins-phase-2-hosts.md rule 9 (gap 4) — « À venir » opens the arrival SAS only while the
// `sas` plugin is active: its card buttons ask, and the dialog comes from the `sas.dialog` slot.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getReservations: vi.fn(),
    getReservation: vi.fn(),
    markPayment: vi.fn(),
    getReservationSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
  },
}));

const enabled = new Set();
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));

import api from '../../api';
import ReservationsUpcomingPage from '../ReservationsUpcomingPage';

const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const STAY = {
  id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Tente', platform: 'direct',
  startDate: TOMORROW, endDate: '2099-01-02', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, teens: 0, children: 0, babies: 0, options: [], resources: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <ReservationsUpcomingPage />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  enabled.clear();
  vi.clearAllMocks();
  api.getReservations.mockResolvedValue([STAY]);
  api.getReservation.mockResolvedValue(STAY);
  api.getReservationSas.mockReturnValue(new Promise(() => {}));
});

test('specs/plugins-phase-2-hosts.md rule 9 — without sas, the « À venir » cards carry no SAS button (gap 4)', async () => {
  renderPage();
  expect(await screen.findByText(/Dupont/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check-in (SAS arrivée)' })).not.toBeInTheDocument();
  expect(api.getReservationSas).not.toHaveBeenCalled();
});

test('specs/plugins-phase-2-hosts.md rule 9 — with sas active, the button opens the dialog contributed to sas.dialog', async () => {
  enabled.add('sas');
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Check-in (SAS arrivée)' }));
  await waitFor(() => expect(api.getReservationSas).toHaveBeenCalledWith(1, 'arrival'));
});
