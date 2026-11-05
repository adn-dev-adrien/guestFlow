// specs/reservations-backend-mvc.md rule 16 (audit R22-C4) — an answer that a newer question has overtaken never
// reaches the fiche: the occupied dates, the client search and the resources' availability.
import React from 'react';
import { vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

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
import { STAY, arrivalField, dayIn, heldAnswers, moveArrival, openPage, seedFiche } from './reservationPageHarness';

const OLD = dayIn(31);
const NEW = dayIn(32);

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api);
});

test('rule 16 — the occupied dates of the older range do not wipe the conflict of the current one', async () => {
  const other = { id: 99, propertyId: 1, startDate: NEW, endDate: STAY.endDate, status: 'confirmed', platform: 'direct', adults: 2 };
  api.getReservations.mockResolvedValue([other]);
  const answers = heldAnswers(api.getOccupiedDates, (_p, start) => start, (start) => (start === NEW ? [NEW] : []));
  openPage();
  const arrival = await arrivalField();
  answers.hold(OLD);
  moveArrival(arrival, OLD);
  await waitFor(() => expect(api.getOccupiedDates.mock.calls.some((args) => args[1] === OLD)).toBe(true));
  moveArrival(arrival, NEW);
  expect((await screen.findAllByText(/déjà réservé/)).length).toBeGreaterThan(0);
  await answers.release(OLD, []);
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getAllByText(/déjà réservé/).length).toBeGreaterThan(0);
});

test('rule 16 — the failure of the older range does not wipe the conflict of the current one', async () => {
  const other = { id: 99, propertyId: 1, startDate: NEW, endDate: STAY.endDate, status: 'confirmed', platform: 'direct', adults: 2 };
  api.getReservations.mockResolvedValue([other]);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const answers = heldAnswers(api.getOccupiedDates, (_p, start) => start, (start) => (start === NEW ? [NEW] : []));
  openPage();
  const arrival = await arrivalField();
  answers.hold(OLD);
  moveArrival(arrival, OLD);
  await waitFor(() => expect(api.getOccupiedDates.mock.calls.some((args) => args[1] === OLD)).toBe(true));
  moveArrival(arrival, NEW);
  expect((await screen.findAllByText(/déjà réservé/)).length).toBeGreaterThan(0);
  await answers.refuse(OLD, new Error('réseau'));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getAllByText(/déjà réservé/).length).toBeGreaterThan(0);
  logged.mockRestore();
});

test('rule 16 — the search of an older text does not empty the list of the current one', async () => {
  api.getReservation.mockResolvedValue({ ...STAY, clientId: null });
  const alice = { id: 5, firstName: 'Alice', lastName: 'Martin', email: 'a@example.test' };
  const answers = heldAnswers(api.getClients, (q) => q, (q) => (q === 'a' ? [alice] : []));
  openPage('/reservations/new');
  const box = await screen.findByLabelText('Rechercher un client');
  answers.hold('zzzq');
  fireEvent.change(box, { target: { value: 'zzzq' } });
  await waitFor(() => expect(api.getClients).toHaveBeenCalledWith('zzzq'));
  fireEvent.change(box, { target: { value: 'a' } });
  expect(await screen.findByRole('option', { name: /Alice/ })).toBeInTheDocument();
  await answers.release('zzzq', []);
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getByRole('option', { name: /Alice/ })).toBeInTheDocument();
});

const resourceAt = (available) => [{ id: 20, name: 'Vélo', price: 5, priceType: 'per_stay', available }];

test('rule 16 — the availability of the older range does not replace the current one', async () => {
  const answers = heldAnswers(api.getResourcesAvailability, ({ startDate }) => startDate, (start) => resourceAt(start === NEW ? 2 : 4));
  openPage();
  const arrival = await arrivalField();
  answers.hold(OLD);
  moveArrival(arrival, OLD);
  await waitFor(() => expect(api.getResourcesAvailability.mock.calls.some(([q]) => q.startDate === OLD)).toBe(true));
  moveArrival(arrival, NEW);
  expect(await screen.findByText(/2 dispo/)).toBeInTheDocument();
  await answers.release(OLD, resourceAt(9));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getByText(/2 dispo/)).toBeInTheDocument();
  expect(screen.queryByText(/9 dispo/)).toBeNull();
});

test('rule 16 — back on the range already shown, the answer for the range just left is dropped', async () => {
  const answers = heldAnswers(api.getResourcesAvailability, ({ startDate }) => startDate, () => resourceAt(4));
  openPage();
  const arrival = await arrivalField();
  expect(await screen.findByText(/4 dispo/)).toBeInTheDocument();
  answers.hold(OLD);
  moveArrival(arrival, OLD);
  await waitFor(() => expect(api.getResourcesAvailability.mock.calls.some(([q]) => q.startDate === OLD)).toBe(true));
  moveArrival(arrival, STAY.startDate);
  await answers.release(OLD, resourceAt(9));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getByText(/4 dispo/)).toBeInTheDocument();
  expect(screen.queryByText(/9 dispo/)).toBeNull();
});

test('rule 16 — moving onto a range the server would refuse drops the answer on its way', async () => {
  const answers = heldAnswers(api.getResourcesAvailability, ({ startDate }) => startDate, () => resourceAt(4));
  openPage();
  const arrival = await arrivalField();
  expect(await screen.findByText(/4 dispo/)).toBeInTheDocument();
  answers.hold(OLD);
  moveArrival(arrival, OLD);
  await waitFor(() => expect(api.getResourcesAvailability.mock.calls.some(([q]) => q.startDate === OLD)).toBe(true));
  fireEvent.change(screen.getByLabelText('Date de départ'), { target: { value: dayIn(10) } });
  await answers.release(OLD, resourceAt(9));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(screen.getByText(/4 dispo/)).toBeInTheDocument();
  expect(screen.queryByText(/9 dispo/)).toBeNull();
});
