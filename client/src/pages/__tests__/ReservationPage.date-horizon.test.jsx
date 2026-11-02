// specs/reservations-backend-mvc.md rule 13 (Adrien's decision of 2026-11-02) — the fiche and the devis say
// « Date trop lointaine : 5 ans au plus. » under the dates for a date typed past today + 5 years, ask neither a
// quote nor the occupied dates for it, and « Enregistrer » refuses before any request. A date the record already
// carries is not held to the horizon. And (review of PR #937, R2) a range the server refuses is not sent to the
// occupied dates.
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
import { horizonEnd } from '../../utils/dateHorizon';

const TOO_FAR = 'Date trop lointaine : 5 ans au plus.';
const ORDER = "La date de départ doit suivre la date d'arrivée.";
const H = horizonEnd();
const ARRIVAL = addIsoDays(H, -3);
const STORED_DEPARTURE = addIsoDays(H, -1);
const ficheAt = (startDate, endDate) => ({
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate, endDate,
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${localIsoToday()} 10:00:00`,
});
const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: ARRIVAL, endDate: STORED_DEPARTURE, status: 'sent',
  adults: 2, platform: 'direct', notes: '', updatedAt: `${localIsoToday()} 10:00:00`, options: [], resources: [], customOptions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.calculatePrice.mockResolvedValue({ optionLines: [], resourceLines: [] });
  api.getReservation.mockResolvedValue(ficheAt(ARRIVAL, STORED_DEPARTURE));
  api.getDevisById.mockResolvedValue(DEVIS);
  api.updateReservation.mockResolvedValue(ficheAt(ARRIVAL, STORED_DEPARTURE));
  api.updateDevis.mockResolvedValue(DEVIS);
});

function openAt(entry, path) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path={path} element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function typeDeparture(value, stored = STORED_DEPARTURE) {
  const departure = await screen.findByLabelText('Date de départ');
  await waitFor(() => expect(departure).toHaveValue(stored));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  fireEvent.change(departure, { target: { value } });
  return departure;
}

const quotedDepartures = () => api.calculatePrice.mock.calls.map(([body]) => body.endDate);
const occupiedDepartures = () => api.getOccupiedDates.mock.calls.map((args) => args[2]);

test('rule 13 — the pure hint: the horizon passes, one day past it does not, a stored date stays allowed', () => {
  expect(stayDatesMessage(ARRIVAL, H)).toBe('');
  expect(stayDatesMessage(ARRIVAL, addIsoDays(H, 1))).toBe(TOO_FAR);
  expect(stayDatesMessage(addIsoDays(H, 1), addIsoDays(H, 3))).toBe(TOO_FAR);
  expect(stayDatesMessage(addIsoDays(H, 1), addIsoDays(H, 3), { stored: { startDate: addIsoDays(H, 1), endDate: addIsoDays(H, 3) } })).toBe('');
  expect(stayDatesMessage(addIsoDays(localIsoToday(), -4000), addIsoDays(localIsoToday(), -3998))).toBe('');
  expect(isQuotableStay(ARRIVAL, addIsoDays(H, 1))).toBe(false);
});

test('rule 13 — a departure one day past the horizon says so, asks for no quote nor occupied dates, and the save sends nothing', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  const tooFar = addIsoDays(H, 1);
  const departure = await typeDeparture(tooFar);
  expect(await screen.findByText(TOO_FAR)).toBeInTheDocument();
  expect(departure).toHaveAttribute('aria-invalid', 'true');
  expect(quotedDepartures()).not.toContain(tooFar);
  expect(occupiedDepartures()).not.toContain(tooFar);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_FAR })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('rule 13 — a departure on the horizon is quoted and shows no hint', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  await typeDeparture(H);
  await waitFor(() => expect(quotedDepartures()).toContain(H));
  await waitFor(() => expect(occupiedDepartures()).toContain(H));
  expect(screen.queryByText(TOO_FAR)).not.toBeInTheDocument();
});

test('rule 13 — a fiche stored past the horizon opens without the hint and still asks for its occupied dates', async () => {
  const start = addIsoDays(H, 10);
  const end = addIsoDays(H, 12);
  api.getReservation.mockResolvedValue(ficheAt(start, end));
  openAt('/reservations/22331', '/reservations/:reservationId');
  const departure = await screen.findByLabelText('Date de départ');
  await waitFor(() => expect(departure).toHaveValue(end));
  await waitFor(() => expect(occupiedDepartures()).toContain(end));
  expect(screen.queryByText(TOO_FAR)).not.toBeInTheDocument();
});

test('the devis shows the hint and refuses the save before any request', async () => {
  openAt('/reservations/new?mode=devis&devisId=77', '/reservations/new');
  const tooFar = addIsoDays(H, 1);
  await typeDeparture(tooFar);
  expect(await screen.findByText(TOO_FAR)).toBeInTheDocument();
  expect(quotedDepartures()).not.toContain(tooFar);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_FAR })));
  expect(api.updateDevis).not.toHaveBeenCalled();
});

test('R2 (review of #937) — a reversed range is not sent to the occupied dates', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  const reversed = addIsoDays(ARRIVAL, -1);
  await typeDeparture(reversed);
  expect(await screen.findByText(ORDER)).toBeInTheDocument();
  expect(occupiedDepartures()).not.toContain(reversed);
});
