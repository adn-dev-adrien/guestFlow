// specs/resource-booking-pricing-and-invoicing.md rules 25, 29-31 — the one-screen arrival of a guest with no stay.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';

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

const BOOKING = {
  id: 5, resourceId: 3, resourceName: 'Bain nordique', date: '2099-02-13', startTime: '18:00', endTime: '20:00', propertyId: null,
  displayName: 'Claire Martin', external: true, arrived: false, paid: false, frozen: false, payment: null, invoice: null,
  offeredMinutes: 0, totalPrice: 120, billing: { street: '', postcode: '', city: '' }, invoiceReady: true,
};
const PRICE = (total, offered = 0) => ({
  total, rateGrid: 'external', freeMinutesApplied: 0, invoiceReady: true,
  lines: [
    { key: 'band:day', label: 'Jour · 18:00–19:00', detail: '1 h × 50,00 €', amount: 50 },
    { key: 'band:evening', label: 'Soir · 19:00–20:00', detail: '1 h × 70,00 €', amount: 70 },
    ...(offered ? [{ key: 'offered', label: 'Temps offert', detail: `${offered} min`, amount: -(120 - total) }] : []),
  ],
  vat: { rate: 20, amount: total / 6, net: total - total / 6 },
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getResourceBooking.mockResolvedValue(BOOKING);
  api.previewResourceBooking.mockImplementation(async (draft) => PRICE(120 - (draft.offeredMinutes / 60) * 50, draft.offeredMinutes));
});

const validate = () => screen.getByRole('button', { name: "Valider l'arrivée" });

test('rule 29 — the session and its price lines, the offered time, the payment and the invoice on one screen', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Jour · 18:00–19:00')).toBeInTheDocument();
  expect(screen.getByText('Sa séance')).toBeInTheDocument();
  expect(screen.getByText('Paiement')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Plus 15 minutes' })).toBeInTheDocument();
  expect(screen.getByText('Créer la facture dans Qonto')).toBeInTheDocument();
});

test('rule 29 — offering 15 minutes asks the server again; rule 30 — one commit with the payment and the invoice', async () => {
  const onDone = vi.fn();
  api.recordResourceBookingArrival.mockResolvedValue({ booking: { ...BOOKING, arrived: true, paid: true }, invoice: { ok: true, number: 'F-1' } });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  await screen.findByText('Jour · 18:00–19:00');
  fireEvent.click(screen.getByRole('button', { name: 'Plus 15 minutes' }));
  await waitFor(() => expect(api.previewResourceBooking).toHaveBeenLastCalledWith(expect.objectContaining({ offeredMinutes: 15 }), expect.anything()));
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(validate());
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const body = api.recordResourceBookingArrival.mock.calls[0][1];
  expect(body.offeredMinutes).toBe(15);
  expect(body.invoice).toBe(true);
  expect(body.payment.tenders).toEqual([{ method: 'card', amountCents: 10750, internal: false }]);
});

test('rule 31 — « Pas maintenant » commits the arrival alone', async () => {
  api.recordResourceBookingArrival.mockResolvedValue({ booking: { ...BOOKING, arrived: true }, invoice: null });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Jour · 18:00–19:00');
  fireEvent.click(screen.getByRole('button', { name: 'Pas maintenant' }));
  expect(screen.getByText(/séance à encaisser/)).toBeInTheDocument();
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(validate());
  await waitFor(() => expect(api.recordResourceBookingArrival).toHaveBeenCalled());
  expect(api.recordResourceBookingArrival.mock.calls[0][1].payment).toBeNull();
  expect(api.recordResourceBookingArrival.mock.calls[0][1].invoice).toBe(false);
});

test('rule 25 — Qonto asks for the address: the payment stays, the address opens, « Créer la facture » retries', async () => {
  const onDone = vi.fn();
  const paid = { ...BOOKING, arrived: true, paid: true, payment: { paidAt: '2099-02-13', label: 'CB', onTheBooks: true, hasCard: true, tenders: [] } };
  api.recordResourceBookingArrival.mockResolvedValue({ booking: paid, invoice: { ok: false, code: 'QONTO_NEEDS_ADDRESS', error: 'adresse' } });
  api.issueResourceBookingInvoice.mockResolvedValue({ ...paid, frozen: true });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  await screen.findByText('Jour · 18:00–19:00');
  await waitFor(() => expect(validate()).toBeEnabled());
  fireEvent.click(validate());
  expect(await screen.findByText("Qonto demande l'adresse de facturation pour émettre la facture.")).toBeInTheDocument();
  expect(screen.getByText(/Encaissé : CB/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Code postal'), { target: { value: '07000' } });
  const retry = screen.getAllByRole('button', { name: 'Créer la facture' }).pop();
  fireEvent.click(retry);
  await waitFor(() => expect(api.issueResourceBookingInvoice).toHaveBeenCalledWith(5, { billing: { street: '', postcode: '07000', city: '' } }));
  expect(onDone).toHaveBeenCalled();
});
