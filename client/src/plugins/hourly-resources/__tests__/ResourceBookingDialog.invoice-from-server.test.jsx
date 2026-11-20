// specs/outside-booking-sas.md rule 54 (stabilisation loop t2, B2-7; CLAUDE.md §6.0) — at « Payé maintenant », « Créer la facture dans Qonto » is offered iff the
// server, asked with the payment typed, answers `invoiceable.ok`: the booking dialog's preview and the arrival's quote carry the payment, the dialogs read the answer.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { localIsoDate } from '../localDate';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn(() => Promise.resolve({ occupiedSlots: [] })),
    getClientPicker: vi.fn(() => Promise.resolve({ options: [] })),
    getProperties: vi.fn(() => Promise.resolve([])),
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
const PRICE = { total: 50, pricing: 'banded', rateGrid: 'external', durationMinutes: 60, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: true };

async function fillNewBooking() {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name: '17:00' }));
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
}

const answering = (invoiceable) => async (draft) => (draft.payment ? { ...PRICE, invoiceable } : PRICE);

beforeEach(() => { vi.clearAllMocks(); });

test('B2-7 — the server says yes for the payment typed: the checkbox is offered, and the preview carried the tenders', async () => {
  api.previewResourceBooking.mockImplementation(answering({ ok: true, code: null, reason: null }));
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
  await fillNewBooking();
  expect(await screen.findByText('Créer la facture dans Qonto')).toBeInTheDocument();
  const asked = api.previewResourceBooking.mock.calls.map(([draft]) => draft).find((draft) => draft.payment);
  expect(asked.payment.tenders.length).toBeGreaterThan(0);
});

test('B2-7 — the server says no (whatever the tenders look like): no checkbox', async () => {
  api.previewResourceBooking.mockImplementation(answering({ ok: false, code: 'ISSUER_UNAVAILABLE', reason: 'Facturation Qonto non connectée.' }));
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
  await fillNewBooking();
  await waitFor(() => expect(api.previewResourceBooking.mock.calls.some(([draft]) => draft.payment)).toBe(true));
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(screen.queryByText('Créer la facture dans Qonto')).toBeNull();
});
