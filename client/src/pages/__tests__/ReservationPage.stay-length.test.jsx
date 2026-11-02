// specs/reservations-backend-mvc.md rule 12, reading of 2026-11-02 (audit R19-L1) — the fiche and the devis say
// « Séjour trop long. » under the dates as soon as the departure is more than 366 nights after the arrival, ask for
// no quote for such a range (a 9999 departure froze the server), and « Enregistrer » refuses before any request.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { stayDatesMessage } from '../../utils/stayDates';
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

const TOO_LONG = 'Séjour trop long.';
// Inside the date horizon (rule 13): the arrival a month ahead, 366 nights then 367.
const ARRIVAL = addIsoDays(localIsoToday(), 30);
const STORED_DEPARTURE = addIsoDays(ARRIVAL, 2);
const LAST_SOUND_DEPARTURE = addIsoDays(ARRIVAL, 366);
const ONE_NIGHT_TOO_MANY = addIsoDays(ARRIVAL, 367);
const FICHE = {
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate: ARRIVAL, endDate: STORED_DEPARTURE,
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${localIsoToday()} 10:00:00`,
};
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
  api.getReservation.mockResolvedValue(FICHE);
  api.getDevisById.mockResolvedValue(DEVIS);
  api.updateReservation.mockResolvedValue(FICHE);
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

async function typeDeparture(value) {
  const departure = await screen.findByLabelText('Date de départ');
  await waitFor(() => expect(departure).toHaveValue(STORED_DEPARTURE));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  fireEvent.change(departure, { target: { value } });
  return departure;
}

const quotedDepartures = () => api.calculatePrice.mock.calls.map(([body]) => body.endDate);

test('the pure hint: 366 nights pass, 367 and a 9999 departure are too long', () => {
  expect(stayDatesMessage(ARRIVAL, LAST_SOUND_DEPARTURE)).toBe('');
  expect(stayDatesMessage(ARRIVAL, ONE_NIGHT_TOO_MANY)).toBe(TOO_LONG);
  expect(stayDatesMessage(ARRIVAL, '9999-12-31')).toBe(TOO_LONG);
  expect(stayDatesMessage(ARRIVAL, '')).toBe('');
});

test.each([
  ['a 367-night stay', ONE_NIGHT_TOO_MANY],
  ['a 9999-12-31 departure', '9999-12-31'],
])('%s shows « Séjour trop long. », asks for no quote, and the save sends nothing', async (_name, endDate) => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  const departure = await typeDeparture(endDate);
  expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
  expect(departure).toHaveAttribute('aria-invalid', 'true');
  expect(quotedDepartures()).not.toContain(endDate);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_LONG })));
  expect(api.updateReservation).not.toHaveBeenCalled();
  expect(quotedDepartures()).not.toContain(endDate);
});

test('a 366-night stay is quoted and shows no hint', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  await typeDeparture(LAST_SOUND_DEPARTURE);
  await waitFor(() => expect(quotedDepartures()).toContain(LAST_SOUND_DEPARTURE));
  expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
});

test('the devis shows the hint, asks for no quote and refuses the save before any request', async () => {
  openAt('/reservations/new?mode=devis&devisId=77', '/reservations/new');
  await typeDeparture(ONE_NIGHT_TOO_MANY);
  expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
  expect(quotedDepartures()).not.toContain(ONE_NIGHT_TOO_MANY);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_LONG })));
  expect(api.updateDevis).not.toHaveBeenCalled();
});
