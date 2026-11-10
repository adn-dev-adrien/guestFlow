// specs/resource-booking-pricing-and-invoicing.md rules 13, 45 (R35b N1) — a guest who paid at booking time arrives:
// « Valider l'arrivée » records the arrival and never makes a Qonto invoice nobody asked for; « Créer la facture » in the
// invoice block is the explicit choice (arrival, then the invoice).
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

const CHEQUE = { paidAt: localIsoDate(), tenders: [{ method: 'cheque', amountCents: 12000 }], label: 'Chèque', onTheBooks: true, hasCard: false };
const CARD = { ...CHEQUE, tenders: [{ method: 'card', amountCents: 12000 }], label: 'CB', hasCard: true };
const paidBefore = (payment) => ({
  id: 5, resourceId: 3, resourceName: 'Bain fictif', date: localIsoDate(), startTime: '18:00', endTime: '20:00', propertyId: null,
  displayName: 'Alex Exemple', external: true, arrived: false, paid: true, frozen: false, payment, invoice: null,
  offeredMinutes: 0, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, invoiceReady: true,
});

beforeEach(() => { vi.clearAllMocks(); });

test.each([['cheque', CHEQUE], ['card', CARD]])('rule 45 — paid by %s before, Qonto ready: « Valider l\'arrivée » sends invoice false', async (_, payment) => {
  const booking = paidBefore(payment);
  api.getResourceBooking.mockResolvedValue(booking);
  api.recordResourceBookingArrival.mockResolvedValue({ booking: { ...booking, arrived: true }, invoice: null });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole('button', { name: "Valider l'arrivée" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const body = api.recordResourceBookingArrival.mock.calls[0][1];
  expect(body.invoice).toBe(false);
  expect(body.payment).toBeNull();
  expect(api.issueResourceBookingInvoice).not.toHaveBeenCalled();
}, 15000);

test('rule 45 — « Créer la facture » is the explicit choice: the arrival goes with invoice true', async () => {
  const booking = paidBefore(CHEQUE);
  api.getResourceBooking.mockResolvedValue(booking);
  api.recordResourceBookingArrival.mockResolvedValue({ booking: { ...booking, arrived: true }, invoice: { ok: true, number: 'F-1' } });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Créer la facture' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(api.recordResourceBookingArrival).toHaveBeenCalledTimes(1);
  expect(api.recordResourceBookingArrival.mock.calls[0][1].invoice).toBe(true);
}, 15000);
