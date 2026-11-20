// specs/outside-booking-sas.md rule 54 (reading 2026-11-16, loop t3 UI3-4, UI3-5) — at « Payé maintenant » the booking dialog saves only once the
// server has answered for the payment typed (never a save carrying no invoice because the answer was still on its way); a failed answer shows
// « Facture non vérifiée pour ce paiement. » with « Réessayer »; « Caisse interne » and the other refusals are the server's words.
// Reading 2026-11-16 (loop t4 UI4-3): the payment preview carries the draft, yet a refused draft has no price, so no payment preview, and a
// failed draft keeps its last price without a second message: one error, one « Réessayer », in both cases.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn(() => Promise.resolve({ occupiedSlots: [] })),
    getClientPicker: vi.fn(() => Promise.resolve({ options: [] })),
    getProperties: vi.fn(() => Promise.resolve([])),
    previewResourceBooking: vi.fn(),
    recordResourceBookingPayment: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60,
};
const PRICE = { total: 50, pricing: 'banded', rateGrid: 'external', durationMinutes: 60, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: true };
const OK = { ok: true, code: null, reason: null };

async function fillNewBooking() {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name: '17:00' }));
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
}
const openDialog = () => render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
const saveButton = () => screen.getByRole('button', { name: /^Enregistrer/ });

beforeEach(() => { vi.clearAllMocks(); });

test('UI3-4 — while the answer for the payment typed is on its way, the save waits', async () => {
  let release;
  api.previewResourceBooking.mockImplementation(async (draft) => {
    if (!draft.payment) return PRICE;
    return new Promise((resolve) => { release = () => resolve({ ...PRICE, invoiceable: OK }); });
  });
  openDialog();
  await fillNewBooking();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(saveButton()).toBeDisabled();
  release();
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer et facturer' })).toBeEnabled());
});

test('UI3-4 — a failed answer is shown with « Réessayer »; the retry offers the invoice', async () => {
  let fail = true;
  api.previewResourceBooking.mockImplementation(async (draft) => {
    if (!draft.payment) return PRICE;
    if (fail) throw Object.assign(new Error('Service indisponible'), { status: 503 });
    return { ...PRICE, invoiceable: OK };
  });
  openDialog();
  await fillNewBooking();
  expect(await screen.findByText('Facture non vérifiée pour ce paiement.')).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  // The pending block draws the same label, disabled (loop t25): wait for the answer itself (server-test-isolation rule 11).
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Créer la facture dans Qonto/ })).toBeEnabled());
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
});

test('UI3-5 — « Caisse interne » is the server\'s INTERNAL_CASH, and another refusal prints its reason', async () => {
  let invoiceable = { ok: false, code: 'INTERNAL_CASH', reason: 'Caisse interne : hors comptabilité.', silent: false };
  api.previewResourceBooking.mockImplementation(async (draft) => (draft.payment ? { ...PRICE, invoiceable } : PRICE));
  const view = openDialog();
  await fillNewBooking();
  expect(await screen.findByText(/^Caisse interne : hors comptabilité, pas de facture/)).toBeInTheDocument();
  view.unmount();
  invoiceable = { ok: false, code: 'TENDERS_INVALID', reason: 'Le paiement dépasse le montant dû.', silent: false };
  openDialog();
  await fillNewBooking();
  expect(await screen.findByText('Le paiement dépasse le montant dû.')).toBeInTheDocument();
  expect(screen.queryByText('La facture se propose une fois le paiement saisi.')).toBeNull();
});

async function changeEndTo(time) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: time }));
}

test('UI4-3 — a refusal of the draft itself is shown once, not again for the payment typed', async () => {
  let refuse = false;
  api.previewResourceBooking.mockImplementation(async (draft) => {
    if (refuse) throw Object.assign(new Error('Créneau refusé.'), { status: 409 });
    return draft.payment ? { ...PRICE, invoiceable: OK } : PRICE;
  });
  openDialog();
  await fillNewBooking();
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  refuse = true;
  await changeEndTo('19:00');
  expect(await screen.findByText('Créneau refusé.')).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.getAllByText('Créneau refusé.')).toHaveLength(1);
});

// Loop t23 S23-1 — the price on screen before the failure is not kept: « Prix indisponible » with its one « Réessayer », and no payment
// (hence no payment answer, no second message) until a new price.
test('UI4-3 — a failed draft with a price on screen shows one error and one « Réessayer », and the save waits', async () => {
  let fail = false;
  api.previewResourceBooking.mockImplementation(async (draft) => {
    if (fail) throw Object.assign(new Error('Service indisponible'), { status: 503 });
    return draft.payment ? { ...PRICE, invoiceable: OK } : PRICE;
  });
  openDialog();
  await fillNewBooking();
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  fail = true;
  await changeEndTo('19:00');
  expect(await screen.findByText(/Prix indisponible/)).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
  expect(screen.queryByText('Créer la facture dans Qonto')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Réessayer' })).toHaveLength(1);
  expect(saveButton()).toBeDisabled();
});

// Loop t24 UI24-2 — « Maintenant » then a failed edit (price and payment question fail together), then a good « Réessayer »: the new payment's
// question is pending, never shown with the older payment's « Facture non vérifiée », and the focus stays in the dialog.
test('UI24-2 — after a good « Réessayer », the new payment\'s invoice question is pending without the older failure', async () => {
  let fail = false;
  let hold = false;
  const held = [];
  api.previewResourceBooking.mockImplementation(async (draft) => {
    if (fail) throw Object.assign(new Error('Service indisponible'), { status: 503 });
    if (draft.payment && hold) await new Promise((resolve) => { held.push(resolve); });
    return draft.payment ? { ...PRICE, invoiceable: OK } : PRICE;
  });
  openDialog();
  await fillNewBooking();
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  fail = true;
  await changeEndTo('19:00');
  expect(await screen.findByText(/Prix indisponible/)).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  fail = false;
  hold = true;
  const retry = screen.getByRole('button', { name: 'Réessayer' });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByText(/Prix indisponible/)).toBeNull());
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
  expect(screen.queryAllByRole('button', { name: 'Réessayer' })).toHaveLength(0);
  expect(saveButton()).toBeDisabled();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  held.splice(0).forEach((go) => go());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer et facturer' })).toBeEnabled());
  expect(screen.queryByText('Facture non vérifiée pour ce paiement.')).toBeNull();
});
