// specs/resource-booking-pricing-and-invoicing.md rule 44 (R35-C-L3, R35-C-L5, R35-C-L6) — a new booking paid « Maintenant »:
// the payment is paid whole (no reste, no geste); a refused payment is said where the payment is and the next click edits
// the booking just created instead of creating it twice; the planning reloads after the last step.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn().mockResolvedValue({ occupiedSlots: [] }),
    getClients: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
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
const PRICE = { total: 50, pricing: 'banded', rateGrid: 'external', durationMinutes: 60, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: false };

async function fillNewBooking() {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name: '17:00' }));
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.previewResourceBooking.mockResolvedValue(PRICE);
});

test('rule 44 — the payment is paid whole: no « Reste à percevoir » nor « Geste commercial »', async () => {
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
  await fillNewBooking();
  await waitFor(() => expect(document.querySelector('[data-tender-amount="0"]')).not.toBeNull());
  const amount = document.querySelector('[data-tender-amount="0"]');
  fireEvent.change(amount, { target: { value: '30' } });
  expect(screen.queryByText(/Reste à percevoir/)).toBeNull();
  expect(screen.queryByText(/Geste commercial/)).toBeNull();
});

test('rule 44 — a refused payment is shown, the booking is not created twice, the planning reloads after each step', async () => {
  const onSave = vi.fn().mockResolvedValue({ id: 41 });
  const onCommitted = vi.fn();
  const onClose = vi.fn();
  api.recordResourceBookingPayment.mockRejectedValueOnce(new Error('Date du paiement invalide.')).mockResolvedValueOnce({ id: 41, paid: true });
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={onClose} onSave={onSave} onDelete={() => {}} onCommitted={onCommitted} />);
  await fillNewBooking();
  const save = () => screen.getByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save()).toBeEnabled());
  fireEvent.click(save());
  expect(await screen.findByText('Date du paiement invalide.')).toBeInTheDocument();
  expect(onSave).toHaveBeenLastCalledWith(expect.any(Object), null);
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  // The draft is now the created booking's (bookingId 41): its price is asked again before the next click.
  await waitFor(() => expect(save()).toBeEnabled());
  fireEvent.click(save());
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onSave).toHaveBeenLastCalledWith(expect.any(Object), 41);
  expect(api.recordResourceBookingPayment).toHaveBeenLastCalledWith(41, expect.any(Object));
  expect(onCommitted).toHaveBeenCalledTimes(2);
});
