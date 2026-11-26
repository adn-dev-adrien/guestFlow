// specs/pricing/pricing-components.md rule 101 (§3 rules 27, 31, 37; loop t2 UI2-1, UI2-2, UI2-3, UI2-4) — « Ventes du séjour » on the real fiche:
// a started stay whose mid-stay window is open still sells and moves its lines; a closed window does not; a fiche with typed,
// unsaved edits holds the panel's writes (« Enregistrer d'abord les modifications. ») instead of re-reading and dropping them;
// after a write on a clean fiche the page re-reads quietly; the panel renders the fiche's own `saleDetail` without a second request;
// while that re-read is in flight the fiche is busy (reading 2026-11-16): nothing typed then can be saved on a form older than the server's.
import { vi } from 'vitest';
import { screen, waitFor, fireEvent, within, act } from '@testing-library/react';

vi.setConfig({ testTimeout: 30000 });

const dialogs = vi.hoisted(() => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() }));

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
import { STAY, seedFiche, openPage } from './reservationPageHarness';

const LINE = {
  ref: 'custom:7', kind: 'custom', label: 'Panier', quantity: 1, totalCents: 2500, sourceLabel: 'Fiche', status: 'dueAtDeparture',
  statusLabel: 'À payer au départ', collectAt: 'departure', momentLabel: 'Au départ', movable: true, moments: ['arrival', 'departure'],
  discountCents: 0, stayDiscountShareCents: 0,
};
const DETAIL = { lines: [LINE], totals: { dueCents: 2500 } };
const OPEN_WINDOW = { locked: true, extrasEditable: true, extrasClosedReason: null, arrivalLines: {}, frozenCustomOptionIds: [] };

beforeEach(() => {
  vi.clearAllMocks();
  seedFiche(api, { ...STAY, notes: '', saleDetail: DETAIL });
  api.patchExtraLine.mockResolvedValue({ saleDetail: { lines: [{ ...LINE, collectAt: 'arrival', momentLabel: 'À l’arrivée' }], totals: { dueCents: 2500 } } });
});

test('a started stay with the mid-stay window open offers the sale and the moment menu', async () => {
  seedFiche(api, { ...STAY, notes: '', saleDetail: DETAIL, editLock: OPEN_WINDOW });
  openPage();
  await screen.findByText('Panier');
  expect(screen.getByRole('button', { name: 'Ajouter un produit' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Moment de Panier' })).toBeInTheDocument();
});

test('a started stay whose departure is collected offers neither', async () => {
  seedFiche(api, { ...STAY, notes: '', saleDetail: DETAIL, editLock: { ...OPEN_WINDOW, extrasEditable: false, extrasClosedReason: 'endOfStayCollected' } });
  openPage();
  await screen.findByText('Panier');
  expect(screen.queryByRole('button', { name: 'Ajouter un produit' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Moment de Panier/ })).toBeNull();
});

test('the panel renders the fiche’s own sale detail: no second request', async () => {
  openPage();
  await screen.findByText('Panier');
  expect(api.getSaleDetail).not.toHaveBeenCalled();
});

test('a dirty fiche holds the panel’s writes and keeps the typed edit', async () => {
  openPage();
  fireEvent.change(await screen.findByLabelText(/^Notes/i), { target: { value: 'typed draft' } });
  const moment = await screen.findByRole('button', { name: "Moment de Panier : Enregistrer d'abord les modifications." });
  expect(moment).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(moment);
  expect(screen.queryByRole('menu')).toBeNull();
  const add = screen.getByRole('button', { name: 'Ajouter un produit' });
  expect(add).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(add);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.patchExtraLine).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^Notes/i)).toHaveValue('typed draft');
});

test('a write on a clean fiche re-reads the fiche without the page spinner', async () => {
  openPage();
  await screen.findByText('Panier');
  const notes = screen.getByLabelText(/^Notes/i);
  const loadsBefore = api.getReservation.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Moment de Panier' }));
  fireEvent.click(within(await screen.findByRole('menu')).getByText('À payer à l’arrivée'));
  await waitFor(() => expect(api.getReservation.mock.calls.length).toBeGreaterThan(loadsBefore));
  await waitFor(() => expect(api.getReservation).toHaveBeenCalledTimes(loadsBefore + 1));
  // The page stayed mounted through the re-read: the very same field, never swapped for the loading screen.
  await screen.findByRole('button', { name: 'Moment de Panier' });
  expect(notes).toBeInTheDocument();
  expect(screen.getByLabelText(/^Notes/i)).toBe(notes);
});

test('while the re-read after a write is in flight, the fiche is busy and the save carries the server’s line with the typed note', async () => {
  openPage();
  await screen.findByText('Panier');
  let answer;
  const SOLD = { ...STAY, notes: '', saleDetail: DETAIL, options: [{ isCustom: true, customOptionId: 7, title: 'Panier', totalPrice: 25 }] };
  api.getReservation.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(SOLD); }));
  fireEvent.click(screen.getByRole('button', { name: 'Moment de Panier' }));
  fireEvent.click(within(await screen.findByRole('menu')).getByText('À payer à l’arrivée'));
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  // The slow re-read: the fields are read-only and « Enregistrer » is busy, so no stale form can leave.
  expect(screen.getByLabelText(/^Notes/i)).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await act(async () => { answer(); });
  const notes = screen.getByLabelText(/^Notes/i);
  await waitFor(() => expect(notes).toBeEnabled());
  // The re-read's form is the new baseline: the fiche is clean, the panel open.
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ajouter un produit' })).not.toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(notes, { target: { value: 'typed after the sale' } });
  api.updateReservation.mockResolvedValue({ id: STAY.id });
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.updateReservation).toHaveBeenCalled());
  const payload = api.updateReservation.mock.calls[0][1];
  expect(payload.notes).toBe('typed after the sale');
  expect(payload.customOptions).toEqual([expect.objectContaining({ description: 'Panier', amount: 25 })]);
});
