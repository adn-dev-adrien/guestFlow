// specs/outside-booking-sas.md rule 27 — « Client absent » in the booking dialog of an outside visit, on or after its day: asked, confirmed, the dialog then shows the booking absent
// (the server's answer) and offers neither « Arrivée » nor « Client absent » again; before its day, and once arrived, there is no such action; a refusal of the server is shown where the action is.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn().mockResolvedValue({ occupiedSlots: [] }),
    getClientPicker: vi.fn().mockResolvedValue({ options: [] }),
    getProperties: vi.fn().mockResolvedValue([]),
    previewResourceBooking: vi.fn(),
    markResourceNoShow: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60,
};
const DAY = localIsoDate();
const BOOKING = {
  id: 9, date: DAY, startTime: '18:00', endTime: '20:00', clientName: 'Alex Exemple', notes: '', external: true, arrived: false, noShow: false,
  paid: false, payment: null, frozen: false, invoice: null, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, invoiceReady: false,
};
const PRICE = { total: 120, pricing: 'banded', rateGrid: 'external', durationMinutes: 120, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: false };

function mount(booking) {
  const onCommitted = vi.fn();
  render(<ResourceBookingDialog open resource={RESOURCE} booking={booking} onClose={() => {}} onSave={vi.fn()} onDelete={vi.fn()} onArrival={vi.fn()} onCommitted={onCommitted} />);
  return { onCommitted };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.previewResourceBooking.mockResolvedValue(PRICE);
});

test('rule 27 — « Client absent » is confirmed, sent, and the booking then reads absent with no « Arrivée »', async () => {
  api.markResourceNoShow.mockResolvedValue({ booking: { ...BOOKING, noShow: true, noShowAt: '2099-01-01T20:00:00.000Z' } });
  const { onCommitted } = mount(BOOKING);
  expect(screen.getByRole('button', { name: 'Arrivée' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Client absent' }));
  const confirm = await screen.findByRole('dialog', { name: 'Client absent ?' });
  expect(within(confirm).getByText(/paiements déjà pris restent enregistrés/)).toBeInTheDocument();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.markResourceNoShow).toHaveBeenCalledWith(9));
  expect(await screen.findByText('Client absent : la visite est close.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Client absent' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
  expect(onCommitted).toHaveBeenCalled();
});

test('rule 27 — before its day, or once arrived, a booking offers no « Client absent »', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { unmount } = render(<ResourceBookingDialog open resource={RESOURCE} booking={{ ...BOOKING, date: localIsoDate(tomorrow) }} onClose={() => {}} onSave={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Client absent' })).toBeNull();
  unmount();
  mount({ ...BOOKING, arrived: true });
  expect(screen.queryByRole('button', { name: 'Client absent' })).toBeNull();
});

test('rule 27 — the server\'s refusal is shown where the action is', async () => {
  api.markResourceNoShow.mockRejectedValue(new Error('Client absent : réservé à l’administrateur.'));
  mount(BOOKING);
  fireEvent.click(screen.getByRole('button', { name: 'Client absent' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Client absent ?' })).getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Client absent : réservé à l’administrateur.')).toBeInTheDocument();
});
