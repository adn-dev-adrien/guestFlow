// specs/resource-supplements-total-server-side.md rules 8-16 — the booking dialog renders the server's
// price: it sends the price-relevant draft only, the latest answer wins, a pending / unavailable /
// refused state is said, and a commit at another price is announced, never silent.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn().mockResolvedValue({ occupiedSlots: [] }),
    getClients: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
    previewResourceBooking: vi.fn(),
  },
}));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00',
  slotDuration: 30, minimumUsageMinutes: 60,
};
const BOOKING = {
  id: 9, date: '2099-02-13', startTime: '18:00', endTime: '20:00', clientName: 'Alex Exemple', notes: '', paid: false,
};
const PRICE = (total, extra = {}) => ({
  total, pricing: 'banded', rateGrid: 'external', durationMinutes: 120, freeMinutesApplied: 0, billedMinutes: 120,
  grossTotal: total, bands: [], freeValue: 0, ...extra,
});

function mount(props = {}) {
  const onSave = vi.fn().mockResolvedValue({});
  const onClose = vi.fn();
  render(<ResourceBookingDialog open resource={RESOURCE} booking={BOOKING} onClose={onClose} onSave={onSave} onDelete={() => {}} {...props} />);
  return { onSave, onClose };
}

async function pickEnd(time) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: time }));
}

function pickEndNow(time) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(screen.getByRole('option', { name: time }));
}

const saveButton = () => screen.getByRole('button', { name: /Enregistrer|Calcul du prix…|Enregistrement/ });

beforeEach(() => {
  api.previewResourceBooking.mockReset();
});

test('rules 8, 9 — the draft is the price-relevant state, with no amount and no client', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(70));
  mount();
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenCalledTimes(1));
  expect(api.previewResourceBooking.mock.calls[0][0]).toEqual({
    resourceId: 3, bookingId: 9, date: '2099-02-13', startTime: '18:00', endTime: '20:00', propertyId: null,
  });
  expect(await screen.findByText(/70,00 €/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Nom du client/), { target: { value: 'Alex Exemple-Martin' } });
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'allergie' } });
  await new Promise((resolve) => { setTimeout(resolve, 350); });
  expect(api.previewResourceBooking).toHaveBeenCalledTimes(1);
});

test('rule 10 — three quick end-time changes make one request', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(70));
  mount();
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenCalledTimes(1));
  // Synchronous on purpose: three changes inside the 200 ms window whatever the speed of the runner.
  pickEndNow('19:10');
  pickEndNow('19:20');
  pickEndNow('19:30');
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => { setTimeout(resolve, 350); });
  expect(api.previewResourceBooking).toHaveBeenCalledTimes(2);
  expect(api.previewResourceBooking.mock.calls[1][0].endTime).toBe('19:30');
});

test('rule 11 — a slow answer overtaken by a newer one is ignored', async () => {
  let resolveSlow;
  api.previewResourceBooking
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
    .mockResolvedValue(PRICE(40));
  mount();
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenCalledTimes(1));
  await pickEnd('19:00');
  expect(await screen.findByText(/40,00 €/)).toBeInTheDocument();
  await act(async () => { resolveSlow(PRICE(99)); });
  expect(screen.queryByText(/99,00 €/)).not.toBeInTheDocument();
  expect(screen.getByText(/40,00 €/)).toBeInTheDocument();
});

test('rules 12, 13 — while the price is pending the button reads « Calcul du prix… » and is disabled', async () => {
  let resolve;
  api.previewResourceBooking.mockImplementation(() => new Promise((r) => { resolve = r; }));
  mount();
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenCalled());
  expect(saveButton()).toHaveTextContent('Calcul du prix…');
  expect(saveButton()).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Calcul du prix' })).toBeInTheDocument();
  await act(async () => { resolve(PRICE(70)); });
  await waitFor(() => expect(saveButton()).toBeEnabled());
  expect(saveButton()).toHaveTextContent('Enregistrer');
});

test('rule 14 — a failed preview says « Prix indisponible », blocks the save, and « Réessayer » recovers', async () => {
  api.previewResourceBooking.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(PRICE(70));
  mount();
  expect(await screen.findByText(/Prix indisponible/)).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText(/70,00 €/)).toBeInTheDocument();
  expect(screen.queryByText(/Prix indisponible/)).not.toBeInTheDocument();
  expect(saveButton()).toBeEnabled();
});

test("rule 14 — a refusal of the range shows the server's message", async () => {
  api.previewResourceBooking.mockRejectedValue(Object.assign(new Error('Créneau non disponible (capacité atteinte)'), { status: 409 }));
  mount();
  expect(await screen.findByText('Créneau non disponible (capacité atteinte)')).toBeInTheDocument();
  expect(screen.queryByText(/Prix indisponible/)).not.toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
});

test('rule 16 — a free range reads 0,00 €, and the offered / billed minutes and bands come from the answer', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(0, {
    pricing: 'free', rateGrid: null,
  }));
  mount();
  expect(await screen.findByText(/0,00 €/)).toBeInTheDocument();
});

test('rule 8 — the offered hour and the bands are rendered as the server returned them', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(40, {
    freeMinutesApplied: 60, billedMinutes: 60, grossTotal: 70, freeValue: 30,
    bands: [
      { band: 'day', from: '18:00', to: '19:00', minutes: 60, rate: 30, amount: 30 },
      { band: 'evening', from: '19:00', to: '20:00', minutes: 60, rate: 40, amount: 40 },
    ],
  }));
  mount();
  expect(await screen.findByText(/^· 40,00 €$/)).toBeInTheDocument();
  expect(screen.getByText(/1h offerte · 1h facturée · jour 30,00 € · soir 40,00 €/)).toBeInTheDocument();
});

test('rule 15 — the commit carries the displayed total; a differing stored price keeps the dialog open on a notice', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(70));
  const { onSave, onClose } = mount();
  onSave.mockResolvedValue({ warning: { code: 'BOOKING_TOTAL_DIFFERED', displayed: 70, stored: 40 } });
  await waitFor(() => expect(saveButton()).toBeEnabled());
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].displayedTotal).toBe(70);
  expect(await screen.findByText(/Enregistré à 40,00 € — l'aperçu affichait 70,00 €\./)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalled();
});

test('rule 15 — a commit at the displayed price closes the dialog', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(70));
  const { onSave, onClose } = mount();
  await waitFor(() => expect(saveButton()).toBeEnabled());
  fireEvent.click(saveButton());
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('a failed commit keeps the dialog open', async () => {
  api.previewResourceBooking.mockResolvedValue(PRICE(70));
  const { onSave, onClose } = mount();
  onSave.mockResolvedValue(null);
  await waitFor(() => expect(saveButton()).toBeEnabled());
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onClose).not.toHaveBeenCalled();
});
