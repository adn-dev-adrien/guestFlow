// specs/resource-booking-pricing-and-invoicing.md rules 28, 44 (R35-C-L1, R35-C-L2, R35-C-L4) — the arrival of a guest who
// paid at booking time is still recorded (no payment sent); an invoice cancelled in Qonto is offered again; a refused
// attachment is said on screen.
// specs/server-test-isolation.md rule 16 (audit R36-S3) — each test carries its own 15 s timeout on a loaded runner.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  default: {
    getResourceBooking: vi.fn(),
    previewResourceBooking: vi.fn(),
    recordResourceBookingArrival: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const PAYMENT = { paidAt: localIsoDate(), tenders: [{ method: 'cheque', amountCents: 12000 }], label: 'Chèque', onTheBooks: true, hasCard: false };
const PAID = {
  id: 5, resourceId: 3, resourceName: 'Bain nordique', date: localIsoDate(), startTime: '18:00', endTime: '20:00', propertyId: null,
  displayName: 'Claire Exemple', external: true, arrived: false, paid: true, frozen: false, payment: PAYMENT, invoice: null,
  offeredMinutes: 0, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, invoiceReady: false,
};

beforeEach(() => { vi.clearAllMocks(); });

test('rule 28 — paid at booking time: « Valider l\'arrivée » records the arrival with no payment', async () => {
  api.getResourceBooking.mockResolvedValue(PAID);
  api.recordResourceBookingArrival.mockResolvedValue({ booking: { ...PAID, arrived: true }, invoice: null });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole('button', { name: "Valider l'arrivée" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const body = api.recordResourceBookingArrival.mock.calls[0][1];
  expect(body.payment).toBeNull();
  expect(body.offeredMinutes).toBeUndefined();
}, 15000);

test('A2 — arrived, paid, its invoice cancelled in Qonto: « Créer la facture » again', async () => {
  api.getResourceBooking.mockResolvedValue({ ...PAID, arrived: true, invoiceReady: true, invoice: { number: 'F-1', cancelled: true, attachment: { state: null } } });
  api.issueResourceBookingInvoice.mockResolvedValue({});
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  const buttons = await screen.findAllByRole('button', { name: 'Créer la facture' });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(api.issueResourceBookingInvoice).toHaveBeenCalledWith(5, expect.anything()));
}, 15000);

test('rule 44 — a refused « Réessayer » of the attachment is shown, never swallowed', async () => {
  api.getResourceBooking.mockResolvedValue({
    ...PAID, arrived: true, frozen: true, payment: { ...PAYMENT, hasCard: true }, invoice: { number: 'F-1', cancelled: false, attachment: { state: 'pending' } },
  });
  api.attachResourceBookingInvoice.mockRejectedValue(new Error('Facturation Qonto non connectée.'));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Facturation Qonto non connectée.')).toBeInTheDocument();
}, 15000);
