// specs/outside-booking-sas.md rule 39 (V-8) — the administrator withdraws an open payment link on any day: the block shows on a read-only visit and when nothing is left to collect;
// the reception never gets it.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { visitPayload, fakeQuote } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    withdrawVisitPaymentLink: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

// date-literal-ok: the link's end is printed from the payload, the dialog compares it with no clock
const open = { id: 9, url: 'https://pay.example/9', amountCents: 5000, expiresAt: '2026-11-20T10:00:00Z' };
const withLink = (over = {}) => visitPayload({ paymentLink: { available: true, reason: null, email: null, open }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  api.quoteResourceVisit.mockImplementation(fakeQuote());
});

test('a read-only visit (a past day) still offers « Retirer le lien » to the administrator', async () => {
  api.getResourceVisit.mockResolvedValue(withLink({ access: { writable: false, reason: 'Journée passée.', reception: false } }));
  api.withdrawVisitPaymentLink.mockResolvedValue({ visit: withLink({ paymentLink: { available: true, reason: null, email: null, open: null } }) });
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retirer le lien' }));
  await waitFor(() => expect(api.withdrawVisitPaymentLink).toHaveBeenCalledWith(5, 9));
});

test('with nothing left to collect the open link can still be withdrawn', async () => {
  api.getResourceVisit.mockResolvedValue(withLink({ totals: { totalCents: 12000, paidCents: 12000, remainingCents: 0, refundOwedCents: 0 } }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Retirer le lien' })).toBeEnabled();
});

test('the reception is not offered the withdrawal on a read-only visit', async () => {
  api.getResourceVisit.mockResolvedValue(withLink({ access: { writable: false, reason: 'Journée passée.', reception: true } }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  await screen.findByText('Journée passée.');
  expect(screen.queryByRole('button', { name: 'Retirer le lien' })).toBeNull();
});
