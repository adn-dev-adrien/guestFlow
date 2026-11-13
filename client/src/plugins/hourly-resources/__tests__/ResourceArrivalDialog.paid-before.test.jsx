// specs/resource-booking-pricing-and-invoicing.md rules 28, 44 (R35-C-L1, R35-C-L2, R35-C-L4) and specs/outside-booking-sas.md rule 34 — the visit of a guest who paid at booking time is
// still recorded (no payment sent, the session read « Payée » from the booking); an invoice cancelled in Qonto is offered again; a refused attachment is said on screen.
// specs/server-test-isolation.md rules 16, 17 — these dialog walks run under the client suite's one 30 s budget.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { BOOKING, visitPayload, sessionLine } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const PAYMENT = { paidAt: '2099-02-13', tenders: [{ method: 'cheque', amountCents: 12000 }], label: 'Chèque', onTheBooks: true, hasCard: false };
const PAID_SESSION = sessionLine({ id: null, ref: 'resource-booking:5', status: 'paid', statusLabel: 'Payée', settledCents: 12000, legacy: true, draft: false });
const paidBefore = (over = {}, bookingOver = {}) => visitPayload({
  booking: { ...BOOKING, paid: true, payment: PAYMENT, ...bookingOver },
  lines: [PAID_SESSION],
  totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 },
  session: { offeredMinutes: 0, editable: false },
  invoiceReady: false,
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

test('rule 34 — paid at booking time: the session reads « Payée », nothing is left to pay, « Valider l\'arrivée » records the arrival with no payment', async () => {
  api.getResourceVisit.mockResolvedValue(paidBefore());
  api.commitResourceVisit.mockResolvedValue({ visit: paidBefore({}, { arrived: true }), invoice: null });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  expect(await screen.findByText('Payée')).toBeInTheDocument();
  expect(screen.getByText('Rien à encaisser.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Plus 15 minutes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Valider l’arrivée' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const body = api.commitResourceVisit.mock.calls[0][1];
  expect(body.payment).toBeNull();
  expect(body.offeredMinutes).toBeUndefined();
});

test('A2 — arrived, paid, its invoice cancelled in Qonto: « Créer la facture » again', async () => {
  api.getResourceVisit.mockResolvedValue(paidBefore({ invoiceReady: true, invoice: { number: 'F-1', cancelled: true } }, { arrived: true, invoice: { number: 'F-1', cancelled: true, attachment: { state: null } } }));
  api.issueResourceBookingInvoice.mockResolvedValue({});
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const buttons = await screen.findAllByRole('button', { name: 'Créer la facture' });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(api.issueResourceBookingInvoice).toHaveBeenCalledWith(5, expect.anything()));
});

test('rule 44 — a refused « Réessayer » of the attachment is shown, never swallowed', async () => {
  const invoice = { number: 'F-1', cancelled: false };
  api.getResourceVisit.mockResolvedValue(paidBefore({ invoice, access: { writable: false, reason: 'Facturée : nouvelle vente séparée.', reception: false } }, {
    arrived: true, frozen: true, payment: { ...PAYMENT, hasCard: true }, invoice: { ...invoice, attachment: { state: 'pending' } },
  }));
  api.attachResourceBookingInvoice.mockRejectedValue(new Error('Facturation Qonto non connectée.'));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Facturation Qonto non connectée.')).toBeInTheDocument();
});
