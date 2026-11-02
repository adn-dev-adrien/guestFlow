// specs/reservations-backend-mvc.md rule 13, second reading (review of PR #938, F8 / V2) — the fiche judges the
// date window from the server's day (`GET /api/today`), not the device's: an arrival the device would accept but
// the server would refuse says « Date trop ancienne : 5 ans au plus. » under the dates and is not quoted.
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
import { horizonStart } from '../../utils/dateHorizon';

const TOO_OLD = 'Date trop ancienne : 5 ans au plus.';
const S = horizonStart(localIsoToday());
const STORED_ARRIVAL = addIsoDays(S, 30);
const DEPARTURE = addIsoDays(S, 40);
const fiche = {
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate: STORED_ARRIVAL, endDate: DEPARTURE,
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${localIsoToday()} 10:00:00`,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getToday.mockResolvedValue({ today: addIsoDays(localIsoToday(), 400) });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(fiche);
});

test('rule 13 — an arrival inside the device\'s window but before the server\'s is refused under the dates and not quoted', async () => {
  render(
    <MemoryRouter initialEntries={['/reservations/22331']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const arrival = await screen.findByLabelText("Date d'arrivée");
  await waitFor(() => expect(arrival).toHaveValue(STORED_ARRIVAL));
  expect(screen.queryByText(TOO_OLD)).not.toBeInTheDocument();
  const typed = addIsoDays(STORED_ARRIVAL, 1);
  fireEvent.change(arrival, { target: { value: typed } });
  expect(await screen.findByText(TOO_OLD)).toBeInTheDocument();
  expect(api.calculatePrice.mock.calls.map(([body]) => body.startDate)).not.toContain(typed);
});
