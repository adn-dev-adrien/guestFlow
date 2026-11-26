// specs/sas/outside-booking-sas.md rules 27, 48 — « Client absent » and « Arrivée » in the booking dialog of an outside visit: offered iff the planning row's `actions`
// say so (loop t1 UI-9, loop t2 UI2-6/UI2-7: role, stay and day are the server's call, no browser-clock compare, no second read of the booking); asked, confirmed,
// the answer of the no-show is the booking with its `actions`, shown absent with neither « Arrivée » nor « Client absent »; a refusal is shown where the action is.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn(() => Promise.resolve({ occupiedSlots: [] })),
    getClientPicker: vi.fn(() => Promise.resolve({ options: [] })),
    getProperties: vi.fn(() => Promise.resolve([])),
    previewResourceBooking: vi.fn(),
    markResourceNoShow: vi.fn(),
    getResourceBooking: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60,
};
// date-literal-ok: the dialog compares no date; the row's `actions` decide
const DAY = '2099-02-13';
const BOOKING = {
  id: 9, date: DAY, startTime: '18:00', endTime: '20:00', clientName: 'Alex Exemple', notes: '', external: true, arrived: false, noShow: false,
  paid: false, payment: null, frozen: false, invoice: null, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, invoiceReady: false,
  actions: { noShow: true, arrive: true },
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

test('rule 27 — « Client absent » is confirmed, sent, and the answered booking reads absent with no « Arrivée »; nothing is read again', async () => {
  api.markResourceNoShow.mockResolvedValue({ booking: { ...BOOKING, noShow: true, noShowAt: '2099-01-01T20:00:00.000Z', actions: { noShow: false, arrive: false } } });
  const { onCommitted } = mount(BOOKING);
  expect(screen.getByRole('button', { name: 'Arrivée' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Client absent' }));
  const confirm = await screen.findByRole('dialog', { name: 'Client absent ?' });
  expect(within(confirm).getByText(/paiements déjà pris restent enregistrés/)).toBeInTheDocument();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmer' }));
  await waitFor(() => expect(api.markResourceNoShow).toHaveBeenCalledWith(9));
  expect(await screen.findByText('Client absent : la visite est close.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Client absent' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
  expect(onCommitted).toHaveBeenCalled();
  expect(api.getResourceBooking).not.toHaveBeenCalled();
});

test('rule 27 — the row does not offer them (another day, reception…): neither « Client absent » nor « Arrivée »', () => {
  mount({ ...BOOKING, actions: { noShow: false, arrive: false } });
  expect(screen.queryByRole('button', { name: 'Client absent' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
  expect(api.getResourceBooking).not.toHaveBeenCalled();
});

test('rule 27 — a row without `actions` offers neither', () => {
  const { actions, ...row } = BOOKING;
  mount(row);
  expect(screen.queryByRole('button', { name: 'Client absent' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Arrivée' })).toBeNull();
});

test('an arrived visit keeps « Voir l\'arrivée », whatever its `actions`', () => {
  mount({ ...BOOKING, arrived: true, actions: { noShow: false, arrive: false } });
  expect(screen.getByRole('button', { name: "Voir l'arrivée" })).toBeInTheDocument();
});

test('rule 27 — the server\'s refusal is shown where the action is', async () => {
  api.markResourceNoShow.mockRejectedValue(new Error('Client absent : réservé à l’administrateur.'));
  mount(BOOKING);
  fireEvent.click(await screen.findByRole('button', { name: 'Client absent' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Client absent ?' })).getByRole('button', { name: 'Confirmer' }));
  expect(await screen.findByText('Client absent : réservé à l’administrateur.')).toBeInTheDocument();
});
