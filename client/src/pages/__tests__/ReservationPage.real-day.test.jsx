// specs/reservations-backend-mvc.md rule 12, reading of 2026-11-03 (audit R20-C2) — a departure typed with a 5- or
// 6-digit year (Chromium's year segment takes up to 6 digits) is not a real day: the fiche says « Date de séjour
// invalide. » under the dates and asks neither a quote, nor the occupied dates, nor the resources' availability for it.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(async () => {}), confirm: vi.fn(async () => false), prompt: vi.fn() };

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import ReservationPage from '../ReservationPage';

const INVALID = 'Date de séjour invalide.';
const T = localIsoToday();
const ARRIVAL = addIsoDays(T, 30);
const DEPARTURE = addIsoDays(T, 33);
const fiche = {
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate: ARRIVAL, endDate: DEPARTURE,
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${T} 10:00:00`,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(fiche);
});

test.each([
  ['5', `3${DEPARTURE}`],
  ['6', `20${DEPARTURE}`],
])('rule 12 (R20) — a %s-digit departure year says so and asks nothing for it', async (_digits, typed) => {
  render(
    <MemoryRouter initialEntries={['/reservations/22331']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const departure = await screen.findByLabelText('Date de départ');
  await waitFor(() => expect(departure).toHaveValue(DEPARTURE));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  fireEvent.change(departure, { target: { value: typed } });
  expect(await screen.findByText(INVALID)).toBeInTheDocument();
  const naming = (fn) => fn.mock.calls.filter((args) => JSON.stringify(args).includes(typed));
  for (const fn of [api.calculatePrice, api.getOccupiedDates, api.getResourcesAvailability, api.getBabyBedAvailability]) {
    expect(naming(fn)).toEqual([]);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: INVALID })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});
