// specs/resource-booking-pricing-and-invoicing.md rules 13, 45 (R35b N1) on the mini SAS (specs/outside-booking-sas.md rule 31) — a guest who paid at booking time arrives:
// « Valider l'arrivée » records the arrival and never makes a Qonto invoice nobody asked for; « Créer la facture » in the invoice block is the explicit choice (arrival, then the invoice).
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

const CHEQUE = { paidAt: '2099-02-13', tenders: [{ method: 'cheque', amountCents: 12000 }], label: 'Chèque', onTheBooks: true, hasCard: false };
const CARD = { ...CHEQUE, tenders: [{ method: 'card', amountCents: 12000 }], label: 'CB', hasCard: true };
const paidBefore = (payment, arrived = false) => visitPayload({
  booking: { ...BOOKING, paid: true, payment, arrived },
  lines: [sessionLine({ status: 'paid', statusLabel: 'Payée', settledCents: 12000, legacy: true, draft: false })],
  totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 },
  session: { offeredMinutes: 0, editable: false },
});

beforeEach(() => { vi.clearAllMocks(); });

test.each([['cheque', CHEQUE], ['card', CARD]])('rule 45 — paid by %s before, Qonto ready: « Valider l\'arrivée » sends invoice false', async (_, payment) => {
  api.getResourceVisit.mockResolvedValue(paidBefore(payment));
  api.commitResourceVisit.mockResolvedValue({ visit: paidBefore(payment, true), invoice: null });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Valider l’arrivée' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const body = api.commitResourceVisit.mock.calls[0][1];
  expect(body.invoice).toBe(false);
  expect(body.payment).toBeNull();
  expect(api.issueResourceBookingInvoice).not.toHaveBeenCalled();
});

test('rule 45 — « Créer la facture » is the explicit choice: the commit goes with invoice true', async () => {
  api.getResourceVisit.mockResolvedValue(paidBefore(CHEQUE));
  api.commitResourceVisit.mockResolvedValue({ visit: paidBefore(CHEQUE, true), invoice: { ok: true, number: 'F-1' } });
  const onDone = vi.fn();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Créer la facture' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(api.commitResourceVisit).toHaveBeenCalledTimes(1);
  expect(api.commitResourceVisit.mock.calls[0][1].invoice).toBe(true);
});
