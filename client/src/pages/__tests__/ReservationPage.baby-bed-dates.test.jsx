// specs/reservations-backend-mvc.md rule 17 (audit R22-C6) — the cots left follow the dates: asked when they move,
// waited for on a range the server would refuse, the latest answer only, and a move never rewrites the cots held.
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

const NEARBY = dayIn(31);
const LATER = dayIn(32);
const WITH_BABY = { ...STAY, babies: 1, babyBeds: 1 };
const left = (available) => ({ totalQuantity: 3, reserved: 3 - available, available });
const hint = () => screen.getByLabelText('Lits bébé').closest('.MuiFormControl-root').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, WITH_BABY);
});

test('rule 17 — moving the dates asks again, excluding the fiche, and the hint and ceiling follow', async () => {
  api.getBabyBedAvailability.mockImplementation(async ({ startDate }) => left(startDate === NEARBY ? 2 : 3));
  openPage();
  const arrival = await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  api.getBabyBedAvailability.mockClear();
  moveArrival(arrival, NEARBY);
  await waitFor(() => expect(api.getBabyBedAvailability).toHaveBeenCalledWith(expect.objectContaining({
    propertyId: 1, startDate: NEARBY, endDate: STAY.endDate, excludeReservationId: STAY.id,
  })));
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 1/));
});

test('rule 17 — opening a fiche asks once: the effect recognises the range the load already asked', async () => {
  openPage();
  await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(api.getBabyBedAvailability).toHaveBeenCalledTimes(1);
});

test('rule 17 — a blank fiche asks as soon as both dates are typed', async () => {
  openPage('/reservations/new');
  const arrival = await screen.findByLabelText("Date d'arrivée");
  api.getBabyBedAvailability.mockClear();
  moveArrival(arrival, NEARBY);
  fireEvent.change(screen.getByLabelText('Date de départ'), { target: { value: STAY.endDate } });
  await waitFor(() => expect(api.getBabyBedAvailability).toHaveBeenCalledWith(expect.objectContaining({
    propertyId: 1, startDate: NEARBY, endDate: STAY.endDate,
  })));
});

test('rule 17 — a range the server would refuse is not asked, and the hint waits', async () => {
  openPage();
  await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  api.getBabyBedAvailability.mockClear();
  fireEvent.change(screen.getByLabelText('Date de départ'), { target: { value: dayIn(10) } });
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: \.\.\./));
  expect(api.getBabyBedAvailability).not.toHaveBeenCalled();
});

test('rule 17 — the answer for an older range is dropped', async () => {
  const answers = heldAnswers(api.getBabyBedAvailability, ({ startDate }) => startDate, (start) => left(start === LATER ? 2 : 3));
  openPage();
  const arrival = await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  answers.hold(NEARBY);
  moveArrival(arrival, NEARBY);
  await waitFor(() => expect(api.getBabyBedAvailability.mock.calls.some(([q]) => q.startDate === NEARBY)).toBe(true));
  moveArrival(arrival, LATER);
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 1/));
  await answers.release(NEARBY, left(0));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(hint()).toMatch(/Dispo restante: 1/);
  expect(screen.getByLabelText('Lits bébé')).toHaveValue('1');
});

test('rule 17 — a range with no cot left never rewrites the cots held: the server refuses at save', async () => {
  api.getBabyBedAvailability.mockImplementation(async ({ startDate }) => left(startDate === NEARBY ? 0 : 3));
  openPage();
  const arrival = await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  moveArrival(arrival, NEARBY);
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 0/));
  expect(screen.getByLabelText('Lits bébé')).toHaveValue('1');
});

test('rule 17 — back on the range shown, the answer for the range just left is dropped', async () => {
  const answers = heldAnswers(api.getBabyBedAvailability, ({ startDate }) => startDate, () => left(3));
  openPage();
  const arrival = await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  answers.hold(NEARBY);
  moveArrival(arrival, NEARBY);
  await waitFor(() => expect(api.getBabyBedAvailability.mock.calls.some(([q]) => q.startDate === NEARBY)).toBe(true));
  moveArrival(arrival, STAY.startDate);
  await answers.release(NEARBY, left(0));
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(hint()).toMatch(/Dispo restante: 2/);
});

test('rule 17 — a change of party on a range with no cot left clamps the cots', async () => {
  api.getBabyBedAvailability.mockImplementation(async ({ startDate }) => left(startDate === NEARBY ? 0 : 3));
  openPage();
  const arrival = await arrivalField();
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 2/));
  moveArrival(arrival, NEARBY);
  await waitFor(() => expect(hint()).toMatch(/Dispo restante: 0/));
  expect(screen.getByLabelText('Lits bébé')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Enfants'), { target: { value: '1' } });
  await waitFor(() => expect(screen.getByLabelText('Lits bébé')).toHaveValue('0'));
});
