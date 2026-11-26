// specs/pricing/pricing-components.md §3 rule 94 reading (stabilisation loop t16, S16-1 + S16-2, 2026-11-17) — the quote taken at « Enregistrer » is the
// live preview's own request (`utils/ficheQuoteBody.js`): on an admin-unlocked fiche it carries `unlockPast` like the preview, so the routing
// the preview lifted is the one the save stores (its `resourceLines` are what the PUT posts); and no request names a unit under « undefined »
// for a free line (S16-1: that key priced every new option at the free line's amount).
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

const FREE_LINE = { isCustom: 1, customOptionId: 41, lineId: 3, title: 'Bois', description: 'Bois', quantity: 1, unitPrice: 15, totalPrice: 15, originalTotalPrice: 15, offered: 0, inComplement: 0 };
const STARTED = { ...STAY, startDate: dayIn(-1), endDate: dayIn(2), editLock: { locked: true }, options: [FREE_LINE] };
const quoteBodies = () => api.calculatePrice.mock.calls.map(([body]) => body);
// The quote of the save is the last one asked before the PUT.
const saveQuoteBody = () => {
  const putOrder = api.updateReservation.mock.invocationCallOrder[0];
  const before = api.calculatePrice.mock.invocationCallOrder.map((order, index) => ({ order, index })).filter(({ order }) => order < putOrder);
  return quoteBodies()[before[before.length - 1].index];
};

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, STARTED);
  api.updateReservation.mockResolvedValue({ id: STAY.id });
});

async function editAndSave() {
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'Une note' } });
  const save = await screen.findByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
}

test('S16-2 — on an unlocked fiche the save-time quote carries unlockPast and is the live preview\'s very body', async () => {
  openPage();
  await arrivalField(STARTED.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  const since = api.calculatePrice.mock.calls.length;
  fireEvent.click(await screen.findByRole('button', { name: 'Déverrouiller cette fiche' }));
  await waitFor(() => expect(api.calculatePrice.mock.calls.length).toBeGreaterThan(since));
  await editAndSave();
  const live = quoteBodies().filter((body) => body !== saveQuoteBody()).pop();
  const saved = saveQuoteBody();
  expect(saved.unlockPast).toBe(true);
  expect(saved).toEqual(live);
  expect(api.updateReservation.mock.calls[0][1].unlockPast).toBe(true);
});

test('S16-2 — a locked fiche\'s save-time quote sends no unlock, like its preview', async () => {
  openPage();
  await arrivalField(STARTED.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  await editAndSave().catch(() => {});
  expect(quoteBodies().some((body) => body.unlockPast)).toBe(false);
});

test('S16-1 — no quote of a fiche holding a free line names a unit under « undefined »', async () => {
  openPage();
  await arrivalField(STARTED.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().every((body) => !Object.prototype.hasOwnProperty.call(body.lockedOptionUnits || {}, 'undefined'))).toBe(true);
});
