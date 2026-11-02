// specs/reservations-backend-mvc.md rule 14 (rule 13, the date horizon, met by keyboard entry) with specs/datepicker-close-on-select.md, reading of
// 2026-11-02 (keyboard entry) — a date typed on the keyboard, digit by digit, still meets the horizon: the field
// keeps the focus, « Date trop lointaine : 5 ans au plus. » shows under the dates, the quote, the occupied dates and
// the resources' availability are never asked for it nor for the half-typed years on the way, and the save sends
// nothing.
import React from 'react';
import dayjs from 'dayjs';
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
const availabilityDepartures = () => api.getResourcesAvailability.mock.calls.map(([q]) => q.endDate);

// Chromium, typing a year over a complete date: each digit is a key press followed by a change, and the
// year reads 0002, 0020, 0203, then 2032.
function typeYearDigitByDigit(input, iso) {
  const year = iso.slice(0, 4);
  for (let k = 1; k <= 4; k += 1) {
    fireEvent.keyDown(input, { key: year[k - 1] });
    fireEvent.change(input, { target: { value: `${year.slice(0, k).padStart(4, '0')}${iso.slice(4)}` } });
  }
}

// The stored stay moved a year later: both days six years ahead, a stay of two nights.
const yearLater = (iso) => dayjs(iso).add(1, 'year').format('YYYY-MM-DD');
const FAR_ARRIVAL = yearLater(ARRIVAL);
const FAR_DEPARTURE = yearLater(STORED_DEPARTURE);

async function typeFarStay() {
  const arrival = await screen.findByLabelText("Date d'arrivée");
  const departure = await screen.findByLabelText('Date de départ');
  await waitFor(() => expect(departure).toHaveValue(STORED_DEPARTURE));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  const blurs = [vi.spyOn(arrival, 'blur'), vi.spyOn(departure, 'blur')];
  arrival.focus();
  typeYearDigitByDigit(arrival, FAR_ARRIVAL);
  fireEvent.blur(arrival);
  departure.focus();
  typeYearDigitByDigit(departure, FAR_DEPARTURE);
  return { arrival, departure, blurs };
}

const halfTyped = (iso) => ['0002', '0020', '0203'].map((y) => `${y}${iso.slice(4)}`);

function expectNothingAskedFor(iso) {
  expect(quotedDepartures()).not.toContain(iso);
  expect(occupiedDepartures()).not.toContain(iso);
  expect(availabilityDepartures()).not.toContain(iso);
}

test('rule 14 — a stay typed six years ahead keeps the focus, says it is too far, and nothing is asked nor saved', async () => {
  openAt('/reservations/22331', '/reservations/:reservationId');
  const { arrival, departure, blurs } = await typeFarStay();
  expect(arrival).toHaveValue(FAR_ARRIVAL);
  expect(departure).toHaveValue(FAR_DEPARTURE);
  blurs.forEach((blur) => expect(blur).not.toHaveBeenCalled());
  expect(document.activeElement).toBe(departure);
  expect(await screen.findByText(TOO_FAR)).toBeInTheDocument();
  expect(departure).toHaveAttribute('aria-invalid', 'true');
  halfTyped(FAR_DEPARTURE).forEach(expectNothingAskedFor);
  expectNothingAskedFor(FAR_DEPARTURE);
  expect(api.calculatePrice.mock.calls.map(([body]) => body.startDate)).not.toContain(FAR_ARRIVAL);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_FAR })));
  expect(api.updateReservation).not.toHaveBeenCalled();
});

test('rule 14 — the devis: a stay typed six years ahead says so and the save sends nothing', async () => {
  openAt('/reservations/new?mode=devis&devisId=77', '/reservations/new');
  const { departure, blurs } = await typeFarStay();
  blurs.forEach((blur) => expect(blur).not.toHaveBeenCalled());
  expect(document.activeElement).toBe(departure);
  expect(await screen.findByText(TOO_FAR)).toBeInTheDocument();
  halfTyped(FAR_DEPARTURE).forEach(expectNothingAskedFor);
  expectNothingAskedFor(FAR_DEPARTURE);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le devis' }));
  await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_FAR })));
  expect(api.updateDevis).not.toHaveBeenCalled();
});
