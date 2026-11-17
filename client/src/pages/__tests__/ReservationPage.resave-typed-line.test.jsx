// specs/pricing-components.md §3 rule 94 reading (stabilisation loop t16, VS16-1, 2026-11-17) — a free line typed on the fiche is sent `newLine`
// until a save has stored it, and not after: a save that keeps the fiche open (« Envoyer la demande de solde », a PDF, a note, a ledger mark)
// does not re-read the line's row id, so the next save must not send it as new again (the server would take it for a removed line re-typed:
// a fresh lineId, or 409 LINE_PAID once a note paid it). A line typed after that save is new again.
import React from 'react';
import { vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(async () => {}), confirm: vi.fn(async () => true), prompt: vi.fn() };

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

const FICHE = { ...STAY, depositPaid: 1, onlinePayment: { label: 'Qonto' } };
// The quote echoes the posted free lines, as the server does (applyQuoteToForm rebuilds the form's free lines from it).
const echo = (body) => ({
  optionLines: (body.customOptions || []).map((c) => ({ isCustom: 1, customKey: c.customKey, title: c.description, totalPrice: c.amount, originalTotalPrice: c.amount })),
  resourceLines: [], balanceAmount: 210, finalPrice: 300,
});
const sentFree = (call) => api.updateReservation.mock.calls[call][1].customOptions;

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, FICHE);
  api.calculatePrice.mockImplementation(async (body) => echo(body));
  api.updateReservation.mockResolvedValue({ id: STAY.id });
  api.sendBalanceRequestEmail.mockResolvedValue({ amountCents: 21000, recipientEmail: 'guest@example.test' });
});

async function typeLine(description, amount) {
  fireEvent.click(await screen.findByRole('button', { name: 'Ajouter une ligne' }));
  const fields = await screen.findAllByLabelText('Description');
  const field = fields[fields.length - 1];
  fireEvent.change(field, { target: { value: description } });
  const card = field.closest('.MuiCardContent-root');
  const price = within(card).getByLabelText(/Prix/);
  fireEvent.change(price, { target: { value: String(amount) } });
  fireEvent.blur(price);
  await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => (b.customOptions || []).some((c) => c.description === description && c.amount === amount))).toBe(true));
}

async function saveAndStay(expectedCalls) {
  const button = await screen.findByRole('button', { name: 'Envoyer la demande de solde' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(expectedCalls));
  await waitFor(() => expect(api.sendBalanceRequestEmail).toHaveBeenCalledTimes(expectedCalls));
}

test('VS16-1 — typed line, save-and-stay, save again: the second save does not send it as new (same customKey, no flag)', async () => {
  openPage();
  await arrivalField(FICHE.startDate);
  await typeLine('Bois', 15);
  await saveAndStay(1);
  expect(sentFree(0)).toEqual([expect.objectContaining({ description: 'Bois', amount: 15, newLine: true })]);
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'Une note' } });
  await saveAndStay(2);
  const second = sentFree(1);
  expect(second).toHaveLength(1);
  expect(second[0].customKey).toBe(sentFree(0)[0].customKey);
  expect(second[0]).not.toHaveProperty('newLine');
  // The live preview after the save asks the same: no flag on the stored line.
  const last = api.calculatePrice.mock.calls[api.calculatePrice.mock.calls.length - 1][0];
  expect((last.customOptions || []).every((c) => !c.newLine)).toBe(true);
});

test('VS16-1 — a line typed AFTER the save-and-stay is new, the one already stored is not', async () => {
  openPage();
  await arrivalField(FICHE.startDate);
  await typeLine('Bois', 15);
  await saveAndStay(1);
  await typeLine('Pain', 4);
  await saveAndStay(2);
  const second = sentFree(1);
  expect(second.find((c) => c.description === 'Bois')).not.toHaveProperty('newLine');
  expect(second.find((c) => c.description === 'Pain')).toEqual(expect.objectContaining({ newLine: true }));
});

test('VS16-1 — admin-unlocked fiche: same contract (the save keeps the fiche open, the stored line is not resent as new)', async () => {
  const started = { ...FICHE, startDate: dayIn(-1), endDate: dayIn(2), editLock: { locked: true } };
  seedFiche(api, started);
  api.calculatePrice.mockImplementation(async (body) => echo(body));
  openPage();
  await arrivalField(started.startDate);
  fireEvent.click(await screen.findByRole('button', { name: 'Déverrouiller cette fiche' }));
  await typeLine('Bois', 15);
  await saveAndStay(1);
  expect(sentFree(0)[0]).toEqual(expect.objectContaining({ newLine: true }));
  expect(api.updateReservation.mock.calls[0][1].unlockPast).toBe(true);
  await saveAndStay(2);
  expect(sentFree(1)[0]).not.toHaveProperty('newLine');
  expect(sentFree(1)[0].customKey).toBe(sentFree(0)[0].customKey);
});

test('VS16-1 — a fiche read again (a locked fiche reloads after the save) starts from its stored rows: nothing is remembered', async () => {
  const stored = { ...FICHE, options: [{ isCustom: 1, customOptionId: 41, lineId: 3, title: 'Bois', description: 'Bois', quantity: 1, unitPrice: 15, totalPrice: 15, originalTotalPrice: 15, offered: 0, inComplement: 0 }] };
  seedFiche(api, stored);
  api.calculatePrice.mockImplementation(async (body) => echo(body));
  openPage();
  await arrivalField(stored.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  await saveAndStay(1);
  expect(sentFree(0)).toEqual([expect.objectContaining({ customOptionId: 41, description: 'Bois' })]);
  expect(sentFree(0)[0]).not.toHaveProperty('newLine');
});
