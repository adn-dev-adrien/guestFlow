// specs/pricing/pricing-components.md §3 rule 94 reading (stabilisation loop t15, S15-1, 2026-11-17) — an admin-unlocked fiche is previewed as its save
// prices it: once « Déverrouiller cette fiche » is clicked, every live quote carries `unlockPast: true`, the flag the save sends, so the server
// skips the locked fiche's routing on both. Before, the live quote never sent it and kept the stored routing the save dropped.
import React from 'react';
import { vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

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
import { STAY, arrivalField, dayIn, openPage, seedFiche } from './reservationPageHarness';

const STARTED = { ...STAY, startDate: dayIn(-1), endDate: dayIn(2), editLock: { locked: true } };
const quoteBodies = () => api.calculatePrice.mock.calls.map(([body]) => body);

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, STARTED);
});

test('S15-1 — the live quote of a locked fiche sends no unlock; after « Déverrouiller cette fiche » it sends unlockPast', async () => {
  openPage();
  await arrivalField(STARTED.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().some((body) => body.unlockPast)).toBe(false);

  const since = api.calculatePrice.mock.calls.length;
  fireEvent.click(await screen.findByRole('button', { name: 'Déverrouiller cette fiche' }));
  await waitFor(() => expect(api.calculatePrice.mock.calls.length).toBeGreaterThan(since));
  const after = quoteBodies().slice(since);
  expect(after.every((body) => body.unlockPast === true && body.reservationId === STAY.id)).toBe(true);
});
