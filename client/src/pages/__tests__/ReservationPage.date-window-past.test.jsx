// specs/reservations-backend-mvc.md rule 13, past reading (Adrien's decision of 2026-11-02) — the fiche says
// « Date trop ancienne : 5 ans au plus. » under the dates for a date typed before today − 5 years, asks neither a
// quote nor the occupied dates for it, and « Enregistrer » refuses before any request. Today − 5 years itself
// passes, and a date the record already carries is not held to the window.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { stayDatesMessage, isQuotableStay } from '../../utils/stayDates';
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
const S = horizonStart();
const STORED_ARRIVAL = addIsoDays(S, 1);
const DEPARTURE = addIsoDays(S, 4);
const ficheAt = (startDate, endDate) => ({
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate, endDate,
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${localIsoToday()} 10:00:00`,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(ficheAt(STORED_ARRIVAL, DEPARTURE));
  api.updateReservation.mockResolvedValue(ficheAt(STORED_ARRIVAL, DEPARTURE));
});

function openFiche() {
  render(
    <MemoryRouter initialEntries={['/reservations/22331']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function typeArrival(value) {
  const arrival = await screen.findByLabelText("Date d'arrivée");
  await waitFor(() => expect(arrival).toHaveValue(STORED_ARRIVAL));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  fireEvent.change(arrival, { target: { value } });
  return arrival;
}

const quotedArrivals = () => api.calculatePrice.mock.calls.map(([body]) => body.startDate);
const occupiedArrivals = () => api.getOccupiedDates.mock.calls.map((args) => args[1]);

test('rule 13 (past reading) — the pure hint: today − 5 years passes, one day earlier does not, a stored date stays allowed', () => {
  expect(stayDatesMessage(S, DEPARTURE)).toBe('');
  expect(stayDatesMessage(addIsoDays(S, -1), DEPARTURE)).toBe(TOO_OLD);
  expect(stayDatesMessage(addIsoDays(S, -3), addIsoDays(S, -1))).toBe(TOO_OLD);
  expect(stayDatesMessage(addIsoDays(S, -3), addIsoDays(S, -1), { stored: { startDate: addIsoDays(S, -3), endDate: addIsoDays(S, -1) } })).toBe('');
  expect(isQuotableStay(addIsoDays(S, -1), DEPARTURE)).toBe(false);
});

test('rule 13 (past reading) — an arrival one day before the window says so, asks for no quote nor occupied dates, and the save sends nothing', async () => {
  openFiche();
  const tooOld = addIsoDays(S, -1);
  await typeArrival(tooOld);
  expect(await screen.findByText(TOO_OLD)).toBeInTheDocument();
  expect(quotedArrivals()).not.toContain(tooOld);
  expect(occupiedArrivals()).not.toContain(tooOld);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_OLD })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('rule 13 (past reading) — an arrival on today − 5 years is quoted and shows no hint', async () => {
  openFiche();
  await typeArrival(S);
  await waitFor(() => expect(quotedArrivals()).toContain(S));
  expect(screen.queryByText(TOO_OLD)).not.toBeInTheDocument();
});

test('rule 13 (past reading) — a new fiche opened from URL dates before the window asks nothing for them', async () => {
  const tooOld = addIsoDays(S, -1);
  render(
    <MemoryRouter initialEntries={[`/reservations/new?propertyId=1&startDate=${tooOld}&endDate=${addIsoDays(S, 2)}`]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/new" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const arrival = await screen.findByLabelText("Date d'arrivée");
  await waitFor(() => expect(arrival).toHaveValue(tooOld));
  await waitFor(() => expect(api.getProperty).toHaveBeenCalled());
  const naming = (fn) => fn.mock.calls.filter((args) => JSON.stringify(args).includes(tooOld));
  for (const fn of [api.calculatePrice, api.getResourcesAvailability, api.getBabyBedAvailability, api.getWelcomePack, api.getOccupiedDates]) {
    expect(naming(fn)).toEqual([]);
  }
});
