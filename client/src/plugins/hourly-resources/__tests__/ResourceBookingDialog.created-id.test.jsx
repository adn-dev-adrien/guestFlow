// specs/resource-booking-pricing-and-invoicing.md rule 44 (R35b N3) — a booking created by the dialog whose payment was
// refused is that booking from then on: moving its slot before the next click previews it as itself (`bookingId`) and its
// own slot never counts as taken.
// specs/server-test-isolation.md rule 16 (audit R36-S3) — each test carries its own 15 s timeout on a loaded runner.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn(),
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
const today = localIsoDate();
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return localIsoDate(d); })();

async function pick(start, end) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  const option = await screen.findByRole('option', { name: start });
  expect(option).not.toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(option);
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: end }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.previewResourceBooking.mockResolvedValue(PRICE);
  api.getOccupiedSlots.mockResolvedValue({ occupiedSlots: [] });
});

test('rule 44 — after a refused payment, the slot moved is previewed as the booking created, never against itself', async () => {
  const onSave = vi.fn().mockResolvedValue({ id: 41 });
  api.recordResourceBookingPayment.mockRejectedValueOnce(new Error('Date du paiement invalide.'));
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate={today} booking={null} onClose={() => {}} onSave={onSave} onDelete={() => {}} />);
  await pick('17:00', '18:00');
  fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Date du paiement invalide.')).toBeInTheDocument();

  // The server now has booking 41 on 17:00-18:00: the operator moves it to another day and back, then half an hour later.
  api.getOccupiedSlots.mockResolvedValue({ occupiedSlots: [{ id: 41, startTime: '17:00', endTime: '18:00', turnover: 0 }] });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: tomorrow } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: today } });
  await waitFor(() => expect(api.getOccupiedSlots).toHaveBeenLastCalledWith(3, today));
  await pick('17:30', '18:30');
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenLastCalledWith(
    expect.objectContaining({ bookingId: 41, startTime: '17:30', endTime: '18:30' }), expect.anything(),
  ));
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
}, 15000);
