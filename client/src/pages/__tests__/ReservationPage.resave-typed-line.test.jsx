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

// VS16-2 (rule 79 reading, S13-1 family) — the save-and-stay re-read hands the form the row ids the save wrote: a line renamed before the next
// save is sent with its row id (the server keeps its lineId, discount, moment), and taking the ids is no edit (the fiche stays clean).
test('VS16-2 — typed line saved, re-read answers its row: renamed then saved, the PUT names that row; the ids are no edit', async () => {
  let stored = [];
  api.updateReservation.mockImplementation(async (_id, body) => {
    stored = body.customOptions.map((c, i) => ({ isCustom: 1, customOptionId: 500 + i, lineId: 1 + i, title: c.description, description: c.description, quantity: 1, unitPrice: c.amount, totalPrice: c.amount, originalTotalPrice: c.amount, offered: 0, inComplement: 0 }));
    return { ok: true };
  });
  api.getReservation.mockImplementation(async () => ({ ...FICHE, options: stored }));
  openPage();
  await arrivalField(FICHE.startDate);
  await typeLine('Bois', 15);
  await saveAndStay(1);
  // The re-read landed: the stored row id is on the line, and the fiche is clean (Enregistrer disabled).
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled());
  const field = (await screen.findAllByLabelText('Description'))[0];
  fireEvent.change(field, { target: { value: 'Bûches' } });
  await saveAndStay(2);
  expect(sentFree(1)).toEqual([expect.objectContaining({ customOptionId: 500, description: 'Bûches' })]);
  expect(sentFree(1)[0]).not.toHaveProperty('newLine');
});

// VS16-3 — a repeated label: the save stores « Bois » and « Bois (2) »; the fiche kept open takes each row id AND the stored label (as a reload
// shows it), stays clean, and its next save names each row with its own label — never « Bois » on the « Bois (2) » row (409 LINE_LABEL_TAKEN).
test('VS16-3 — two typed « Bois »: after the save-and-stay the fiche shows « Bois (2) », stays clean, and the next save keeps both rows', async () => {
  let stored = [];
  api.updateReservation.mockImplementation(async (_id, body) => {
    const seen = new Map();
    stored = body.customOptions.map((c, i) => {
      const n = (seen.get(c.description.toLowerCase()) || 0) + 1;
      seen.set(c.description.toLowerCase(), n);
      const title = c.customOptionId != null || n === 1 ? c.description : `${c.description} (${n})`;
      return { isCustom: 1, customOptionId: 600 + i, lineId: 1 + i, title, description: title, quantity: 1, unitPrice: c.amount, totalPrice: c.amount, originalTotalPrice: c.amount, offered: 0, inComplement: 0 };
    });
    return { ok: true };
  });
  api.getReservation.mockImplementation(async () => ({ ...FICHE, options: stored }));
  openPage();
  await arrivalField(FICHE.startDate);
  await typeLine('Bois', 15);
  await typeLine('Bois', 10);
  await saveAndStay(1);
  await waitFor(() => expect(screen.getAllByLabelText('Description').map((f) => f.value)).toEqual(['Bois', 'Bois (2)']));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled());
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'Une note' } });
  await saveAndStay(2);
  expect(sentFree(1)).toEqual([
    expect.objectContaining({ customOptionId: 600, description: 'Bois', amount: 15 }),
    expect.objectContaining({ customOptionId: 601, description: 'Bois (2)', amount: 10 }),
  ]);
});
