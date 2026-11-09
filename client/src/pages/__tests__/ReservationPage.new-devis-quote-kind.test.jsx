// specs/deposit-blocks-the-dates.md rule 19 (D23, audit R33-M-L1) — the live quote of a devis not saved yet is asked as
// a devis (`kind: 'devis'`), so the server prices it with the validity date its create writes: the summary's deadlines
// are the ones « Enregistrer » stores. A saved devis sends its id instead, a reservation sends neither.
import React from 'react';
import { vi } from 'vitest';
import { waitFor } from '@testing-library/react';

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
import { STAY, arrivalField, dayIn, openPage, seedFiche } from './reservationPageHarness';

const RANGE = `propertyId=1&startDate=${dayIn(35)}&endDate=${dayIn(37)}`;
const quoteBodies = () => api.calculatePrice.mock.calls.map(([body]) => body);

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api);
});

test('R33-M-L1 — « Nouveau devis » asks every live quote as a devis', async () => {
  openPage(`/reservations/new?mode=devis&${RANGE}`);
  await arrivalField(dayIn(35));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().every((body) => body.kind === 'devis' && !body.devisId && !body.reservationId)).toBe(true);
});

test('R33-M-L1 — a new reservation and a saved devis do not send the marker', async () => {
  openPage(`/reservations/new?${RANGE}`);
  await arrivalField(dayIn(35));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().some((body) => body.kind === 'devis')).toBe(false);
});

test('R33-M-L1 — an existing devis is quoted by its id, without the marker', async () => {
  api.getDevisById.mockResolvedValue({ ...STAY, id: 77, kind: 'devis', status: 'sent', validUntil: dayIn(15), expired: false });
  openPage('/reservations/new?mode=devis&devisId=77');
  await arrivalField(STAY.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().every((body) => body.devisId === 77 && body.kind === undefined)).toBe(true);
});
