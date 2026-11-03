// specs/reservations-backend-mvc.md rule 13, reading of 2026-11-03 (audit R20-C3) — the fiche's reads that the
// device's day held back are asked once the server's day is known and accepts the dates: the occupied dates, the
// resources' availability and the quote follow `windowToday`, not only the dates.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
import { horizonStart } from '../../utils/dateHorizon';

const DEVICE = localIsoToday();
const S = horizonStart(DEVICE);
const STORED_ARRIVAL = addIsoDays(S, 10);
const DEPARTURE = addIsoDays(S, 13);
const TYPED = addIsoDays(S, -1);
const fiche = {
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate: STORED_ARRIVAL, endDate: DEPARTURE,
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${DEVICE} 10:00:00`,
};

let answerToday;
beforeEach(() => {
  vi.clearAllMocks();
  api.getToday.mockImplementation(() => new Promise((resolve) => { answerToday = resolve; }));
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(fiche);
});

test('rule 13 (R20) — an arrival the device refuses is asked once the server\'s day, one day behind, accepts it', async () => {
  render(
    <MemoryRouter initialEntries={['/reservations/22331']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const arrival = await screen.findByLabelText("Date d'arrivée");
  await waitFor(() => expect(arrival).toHaveValue(STORED_ARRIVAL));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  fireEvent.change(arrival, { target: { value: TYPED } });
  expect(await screen.findByText('Date trop ancienne : 5 ans au plus.')).toBeInTheDocument();
  const naming = (fn) => fn.mock.calls.filter((args) => JSON.stringify(args).includes(TYPED));
  for (const fn of [api.getOccupiedDates, api.getResourcesAvailability, api.calculatePrice]) expect(naming(fn)).toEqual([]);
  await act(async () => { answerToday({ today: addIsoDays(DEVICE, -1) }); });
  await waitFor(() => expect(screen.queryByText('Date trop ancienne : 5 ans au plus.')).not.toBeInTheDocument());
  await waitFor(() => expect(naming(api.getOccupiedDates).length).toBeGreaterThan(0));
  await waitFor(() => expect(naming(api.getResourcesAvailability).length).toBeGreaterThan(0));
  await waitFor(() => expect(naming(api.calculatePrice).length).toBeGreaterThan(0));
});
