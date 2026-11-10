// specs/resource-booking-pricing-and-invoicing.md rule 44 (R35-C-M1, R35-C-M2, R35-C-L1, R35-C-L2) — a stored booking's
// money actions in its dialog: the payment is taken back behind a confirmation, a delete is confirmed and a paid booking
// is not deletable, an invoice cancelled in Qonto can be made again, an invoiced booking's invoice buttons work and its
// fields are read-only.
// specs/server-test-isolation.md rule 16 (audit R36-S3) — each test carries its own 15 s timeout on a loaded runner.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn().mockResolvedValue({ occupiedSlots: [] }),
    getClients: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
    previewResourceBooking: vi.fn(),
    clearResourceBookingPayment: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

import api from '../../../api';
import ResourceBookingDialog from '../ResourceBookingDialog';

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60,
};
const DAY = localIsoDate();
const PAYMENT = { paidAt: DAY, tenders: [{ method: 'card', amountCents: 12000 }], label: 'CB', onTheBooks: true, hasCard: true };
const BOOKING = {
  id: 9, date: DAY, startTime: '18:00', endTime: '20:00', clientName: 'Alex Exemple', notes: '', external: true, arrived: false,
  paid: true, payment: PAYMENT, frozen: false, invoice: null, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, invoiceReady: true,
};
const PRICE = { total: 120, pricing: 'banded', rateGrid: 'external', durationMinutes: 120, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: true };

function mount(booking, props = {}) {
  const onDelete = vi.fn();
  const onCommitted = vi.fn();
  render(<ResourceBookingDialog open resource={RESOURCE} booking={booking} onClose={() => {}} onSave={vi.fn()} onDelete={onDelete} onCommitted={onCommitted} {...props} />);
  return { onDelete, onCommitted };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.previewResourceBooking.mockResolvedValue(PRICE);
});

test('rule 44 — « Retirer le paiement », confirmed, takes the payment back and the dialog shows the booking unpaid', async () => {
  api.clearResourceBookingPayment.mockResolvedValue({ ...BOOKING, paid: false, payment: null });
  const { onCommitted } = mount(BOOKING);
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le paiement' }));
  const dialog = await screen.findByRole('dialog', { name: 'Retirer le paiement ?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.clearResourceBookingPayment).toHaveBeenCalledWith(9));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retirer le paiement' })).toBeNull());
  expect(await screen.findByRole('button', { name: "À l'arrivée" })).toBeInTheDocument();
  expect(onCommitted).toHaveBeenCalled();
}, 15000);

test('rule 34 — a paid booking cannot be deleted; an unpaid one asks before deleting', async () => {
  mount(BOOKING);
  expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled();
}, 15000);

test('rule 44 — deleting an unpaid booking is confirmed first', async () => {
  const { onDelete } = mount({ ...BOOKING, paid: false, payment: null });
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(onDelete).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog', { name: 'Supprimer la réservation ?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
  expect(onDelete).toHaveBeenCalledWith(9);
}, 15000);

test('A2, rule 44 — an invoice cancelled in Qonto: « Créer la facture » is offered again', async () => {
  api.issueResourceBookingInvoice.mockResolvedValue({ ...BOOKING, frozen: true, invoice: { number: 'F-2', cancelled: false, attachment: { state: null } } });
  mount({ ...BOOKING, payment: { ...PAYMENT, hasCard: false }, invoice: { number: 'F-1', cancelled: true, attachment: { state: null } } });
  expect(screen.queryByText('La facture se propose une fois le paiement saisi.')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Créer la facture' }));
  await waitFor(() => expect(api.issueResourceBookingInvoice).toHaveBeenCalledWith(9, expect.anything()));
}, 15000);

test('rules 15, 44 — an invoiced booking: « Réessayer » joins the PDF, a refusal is shown; client and logement are read-only', async () => {
  api.attachResourceBookingInvoice.mockRejectedValue(new Error('Pas de facture à joindre.'));
  mount({ ...BOOKING, frozen: true, invoice: { number: 'F-1', cancelled: false, attachment: { state: 'pending' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(api.attachResourceBookingInvoice).toHaveBeenCalledWith(9));
  expect(await screen.findByText('Pas de facture à joindre.')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Client enregistré' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: /Nom du client/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Retirer le paiement' })).toBeNull();
}, 15000);
