// specs/manual-price-on-placement-change.md — moving a stay whose price was set by hand: the fiche sends the placement the price was
// decided against (rule 4), opens the server's review (rules 2, 9), applies the chosen price (rule 12), or puts the dates back (rule 13).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

vi.setConfig({ testTimeout: 30000 });

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
  useAppDialogs: () => ({ alert: vi.fn(async () => {}), confirm: vi.fn(async () => false), prompt: vi.fn() }),
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

const ARRIVAL = addIsoDays(localIsoToday(), 30);
const STORED_DEPARTURE = addIsoDays(ARRIVAL, 3);
const MOVED_DEPARTURE = addIsoDays(ARRIVAL, 5);
const FICHE = {
  id: 22340, kind: 'reservation', clientId: 1, propertyId: 1, startDate: ARRIVAL, endDate: STORED_DEPARTURE,
  platform: 'direct', adults: 2, reservationNumber: '209922340', options: [], resources: [], customOptions: [],
  totalPrice: 300, customPrice: 270, finalPrice: 270, depositAmount: 0, depositPaid: 0, balanceAmount: 270, balancePaid: 0,
  updatedAt: `${localIsoToday()} 10:00:00`,
};
const REVIEW = {
  reference: { propertyId: 1, propertyName: 'Granja', startDate: ARRIVAL, endDate: STORED_DEPARTURE, nights: 3, totalPrice: 300, seasons: null },
  placement: {
    propertyId: 1, propertyName: 'Granja', startDate: ARRIVAL, endDate: MOVED_DEPARTURE, nights: 5, totalPrice: 500,
    seasons: [{ label: 'Moyenne', nights: 5, amount: 500 }],
  },
  tariffDelta: 200,
  customPrice: 270,
  gap: -30,
  choices: [
    { key: 'keep', customPrice: 270, finalPrice: 270, totalStay: 290 },
    { key: 'keepGap', customPrice: 470, finalPrice: 470, totalStay: 490 },
    { key: 'engine', customPrice: '', finalPrice: 500, totalStay: 520 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
  api.getOccupiedDates.mockResolvedValue([]);
  api.getReservation.mockResolvedValue(FICHE);
  api.updateReservation.mockResolvedValue(FICHE);
  // The server's answer: a review only for the moved dates with a reference (the server owns the comparison).
  api.calculatePrice.mockImplementation(async (body) => ({
    optionLines: [],
    resourceLines: [],
    totalPrice: body.endDate === MOVED_DEPARTURE ? 500 : 300,
    manualPriceReview: body.endDate === MOVED_DEPARTURE && body.customPriceReference && body.customPrice === 270 ? REVIEW : null,
  }));
});

async function openAndMove() {
  render(
    <MemoryRouter initialEntries={[`/reservations/${FICHE.id}`]}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const departure = await screen.findByLabelText('Date de départ');
  await waitFor(() => expect(departure).toHaveValue(STORED_DEPARTURE));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  fireEvent.change(departure, { target: { value: MOVED_DEPARTURE } });
  return departure;
}

test('rule 4 — the move is quoted with the stored placement as the manual price\'s reference', async () => {
  await openAndMove();
  await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => b.endDate === MOVED_DEPARTURE)).toBe(true));
  const moved = api.calculatePrice.mock.calls.map(([b]) => b).find((b) => b.endDate === MOVED_DEPARTURE);
  expect(moved.customPriceReference).toEqual({ propertyId: 1, startDate: ARRIVAL, endDate: STORED_DEPARTURE });
});

test('rules 2, 9, 12, 15 — the review opens on « Garder l\'écart » and applying it sets the manual price', async () => {
  await openAndMove();
  const dialog = await screen.findByRole('dialog', { name: 'Tarif modifié' });
  expect(within(dialog).getByRole('radio', { name: /Garder l'écart/ })).toBeChecked();
  expect(within(dialog).getByText(/Total séjour 490,00/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Appliquer' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tarif modifié' })).not.toBeInTheDocument());
  await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => b.customPrice === 470)).toBe(true));
  const last = api.calculatePrice.mock.calls.at(-1)[0];
  expect(last.customPriceReference).toEqual({ propertyId: 1, startDate: ARRIVAL, endDate: MOVED_DEPARTURE });
});

test('rule 13 — « Annuler le changement » puts the stored dates back and keeps the manual price', async () => {
  const departure = await openAndMove();
  const dialog = await screen.findByRole('dialog', { name: 'Tarif modifié' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler le changement' }));
  await waitFor(() => expect(departure).toHaveValue(STORED_DEPARTURE));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tarif modifié' })).not.toBeInTheDocument());
  expect(api.calculatePrice.mock.calls.at(-1)[0].customPrice).toBe(270);
});

test('rule 16 — a save while the move is being quoted stores nothing; the review opens once the quote is back', async () => {
  let release;
  const answer = api.calculatePrice.getMockImplementation();
  api.calculatePrice.mockImplementation((body) => (body.endDate === MOVED_DEPARTURE
    ? new Promise((resolve) => { release = () => resolve(answer(body)); })
    : answer(body)));
  await openAndMove();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(api.updateReservation).not.toHaveBeenCalled();
  release();
  expect(await screen.findByRole('dialog', { name: 'Tarif modifié' })).toBeInTheDocument();
  expect(api.updateReservation).not.toHaveBeenCalled();
});
