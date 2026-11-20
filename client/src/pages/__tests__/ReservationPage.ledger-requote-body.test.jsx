// specs/pricing-components.md §3 rule 94 reading (stabilisation loop t17, UI17-1, 2026-11-18 — the ui-process reviewer's probe C made
// permanent). The ledger's amount editor re-asks the quote with the fiche's body built when it is sent, never the body the last live quote
// cached: after a save that keeps the fiche open (here « Envoyer la demande de solde ») a typed line is stored, so the ledger re-quote names
// its stored row and no longer sends it `newLine`; before that save it is new.
import { vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

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
import { STAY, arrivalField, openPage, seedFiche } from './reservationPageHarness';

const LEDGER = {
  rows: [{ key: 'balance', label: 'Solde', amount: 210, state: 'due', tone: 'due', stateLabel: 'À percevoir', action: null, detail: null,
    amountEdit: { editable: true, mode: 'split', min: null, max: null, reason: null } }],
  closing: { label: 'Reste à percevoir', amount: 210 }, remaining: 210,
};
const FICHE = { ...STAY, depositPaid: 1, onlinePayment: { label: 'Qonto' }, ledger: LEDGER };
const echo = (body) => ({
  optionLines: (body.customOptions || []).map((c) => ({ isCustom: 1, customKey: c.customKey, title: c.description, totalPrice: c.amount, originalTotalPrice: c.amount })),
  resourceLines: [], balanceAmount: 210, finalPrice: 300, ledger: LEDGER,
  ...(body.ledgerEdit ? { ledgerEdit: { ok: true, effects: [] } } : {}),
});
let stored = [];
const storedOf = (lines) => (lines || []).map((c, i) => ({
  isCustom: 1, customOptionId: 900 + i, title: c.description, description: c.description, quantity: 1, unitPrice: c.amount, totalPrice: c.amount,
  originalTotalPrice: c.amount, offered: 0, inComplement: 0,
}));

beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  seedFiche(api, FICHE);
  api.calculatePrice.mockImplementation(async (body) => echo(body));
  api.updateReservation.mockImplementation(async (_id, body) => { stored = storedOf(body.customOptions); return { id: STAY.id }; });
  api.getReservation.mockImplementation(async () => ({ ...FICHE, options: stored }));
  api.sendBalanceRequestEmail.mockResolvedValue({ amountCents: 21000, recipientEmail: 'guest@example.test' });
});

async function typeLine(description, amount) {
  fireEvent.click(await screen.findByRole('button', { name: 'Ajouter une ligne' }));
  const fields = await screen.findAllByLabelText('Description');
  const field = fields[fields.length - 1];
  fireEvent.change(field, { target: { value: description } });
  const price = within(field.closest('.MuiCardContent-root')).getByLabelText(/Prix/);
  fireEvent.change(price, { target: { value: String(amount) } });
  fireEvent.blur(price);
  await waitFor(() => expect(api.calculatePrice.mock.calls.some(([b]) => (b.customOptions || []).some((c) => c.description === description && c.amount === amount))).toBe(true));
}

async function ledgerBodyFor(value) {
  const before = api.calculatePrice.mock.calls.length;
  fireEvent.click(await screen.findByRole('button', { name: /Modifier le montant : Solde/ }));
  const input = await screen.findByLabelText('Montant du solde (€)');
  fireEvent.change(input, { target: { value } });
  await waitFor(() => expect(api.calculatePrice.mock.calls.slice(before).some(([b]) => b.ledgerEdit)).toBe(true), { timeout: 4000 });
  return api.calculatePrice.mock.calls.slice(before).map(([b]) => b).find((b) => b.ledgerEdit);
}

test('UI17-1 — before any save, the ledger re-quote sends the typed line as new', async () => {
  openPage();
  await arrivalField(FICHE.startDate);
  await typeLine('Bois', 15);
  const body = await ledgerBodyFor('200');
  expect(body.ledgerEdit).toEqual({ row: 'balance', amount: '200' });
  expect(body.customOptions.map((c) => [c.description, Boolean(c.newLine), c.customOptionId ?? null])).toEqual([['Bois', true, null]]);
});

test('UI17-1 — after a save that keeps the fiche open, the ledger re-quote names the stored row and sends no newLine', async () => {
  openPage();
  await arrivalField(FICHE.startDate);
  await typeLine('Bois', 15);
  const send = await screen.findByRole('button', { name: 'Envoyer la demande de solde' });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled());
  await waitFor(() => expect(api.getReservation.mock.calls.length).toBeGreaterThan(1));
  const body = await ledgerBodyFor('200');
  expect(body.customOptions.map((c) => [c.description, Boolean(c.newLine), c.customOptionId ?? null])).toEqual([['Bois', false, 900]]);
});
