// specs/reservations-backend-mvc.md rule 12 (audit R18-1) — the fiche and the devis refuse a departure on or before
// the arrival: the dates show the error as it is typed, and « Enregistrer » refuses with the server's message before
// any request. A refusal of the server itself (400 INVALID_STAY_DATES) is shown as it comes.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

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
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

// A month ahead: inside the date horizon (specs/reservations-backend-mvc.md rule 13), never past.
const ARRIVAL = addIsoDays(localIsoToday(), 30);

const ORDER = "La date de départ doit suivre la date d'arrivée.";
const FICHE = {
  id: 22331, kind: 'reservation', clientId: 1, propertyId: 1, startDate: ARRIVAL, endDate: addIsoDays(ARRIVAL, 2),
  platform: 'direct', adults: 2, reservationNumber: '209922331', options: [], resources: [], customOptions: [],
  depositAmount: 90, depositPaid: 0, balanceAmount: 210, balancePaid: 0, finalPrice: 300, updatedAt: `${localIsoToday()} 10:00:00`,
};
const DEVIS = {
  id: 77, clientId: 1, propertyId: 1, startDate: ARRIVAL, endDate: addIsoDays(ARRIVAL, 2), status: 'sent',
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
  const departure = await screen.findByLabelText("Date de départ");
  await waitFor(() => expect(departure).toHaveValue(addIsoDays(ARRIVAL, 2)));
  fireEvent.change(departure, { target: { value } });
  return departure;
}

test('a departure typed before the arrival shows the error under the dates and the save sends nothing', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  const departure = await typeDeparture(addIsoDays(ARRIVAL, -29));
  expect(await screen.findByText(ORDER)).toBeInTheDocument();
  expect(departure).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: ORDER })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('a departure on the arrival day is refused the same way', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  await typeDeparture(ARRIVAL);
  expect(await screen.findByText(ORDER)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: ORDER })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('the devis refuses a reversed stay before any request', async () => {
  openAt('/reservations/new?mode=devis&devisId=77', '/reservations/new');
  await typeDeparture(addIsoDays(ARRIVAL, -29));
  expect(await screen.findByText(ORDER)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: ORDER })));
  expect(api.updateDevis).not.toHaveBeenCalled();
});

test('a refusal of the server (400 INVALID_STAY_DATES) is shown with its message', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  await typeDeparture(addIsoDays(ARRIVAL, 4));
  expect(screen.queryByText(ORDER)).not.toBeInTheDocument();
  api.calculatePrice.mockRejectedValue(Object.assign(new Error('Date de séjour invalide.'), { code: 'INVALID_STAY_DATES', status: 400 }));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Erreur', message: 'Date de séjour invalide.' })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('a « Nouveau devis » switched to another logement before its dates are typed asks for no quote', async () => {
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }, { id: 2, name: 'Estiva', singleBeds: 2, doubleBeds: 1 }]);
  openAt('/reservations/new?mode=devis&propertyId=1', '/reservations/new');
  const select = await screen.findByRole('combobox', { name: 'Logement' });
  await waitFor(() => expect(select).toHaveTextContent('Granja'));
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByRole('option', { name: 'Estiva' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Logement' })).toHaveTextContent('Estiva'));
  expect(api.calculatePrice).not.toHaveBeenCalled();
  expect(dialogs.alert).not.toHaveBeenCalled();
});
