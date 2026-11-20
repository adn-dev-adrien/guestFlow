// specs/outside-booking-sas.md rule 54 and specs/plugins-phase-1-sdk.md rule 54 (readings of 2026-11-19, loop t25 verifier) — while the
// « Facture » answer for the payment being typed is on its way (a new draft, a slow answer), no answer is current for it: the visit arrival
// and the hourly booking draw the block pending — « Créer la facture dans Qonto » disabled, ticked as the operator left it, the address
// kept and disabled — instead of the older payment's answer, ticked and clickable. The answer then fills it: accepted, the checkbox is live
// again with the operator's state; refused, its reason. Owner decision: no action on an unknown value.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import ResourceBookingDialog from '../ResourceBookingDialog';
import { localIsoDate } from '../localDate';
import { visitPayload, fakeQuote } from './arrivalVisitFixtures';

vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    getOccupiedSlots: vi.fn(),
    getClientPicker: vi.fn(),
    getProperties: vi.fn(),
    previewResourceBooking: vi.fn(),
  },
}));

let release = null;
const hold = () => new Promise((resolve) => { release = resolve; });
const invoiceBox = () => screen.getByRole('checkbox', { name: /Créer la facture dans Qonto/ });
const streetField = () => screen.getByRole('textbox', { name: 'Adresse' });
const ACCEPTED = { ok: true, code: null, reason: null };
const REFUSED = { ok: false, code: 'TARIFF_CHANGED', reason: 'Le tarif a changé : facture à établir dans Qonto.', silent: false };
const RESOURCE = { id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60 };
const PRICE = { total: 50, pricing: 'banded', rateGrid: 'external', durationMinutes: 60, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: true };

const DIALOGS = {
  ResourceArrivalDialog: {
    async open(second) {
      const quote = fakeQuote();
      let answers = 0;
      api.getResourceVisit.mockResolvedValue(visitPayload());
      api.quoteResourceVisit.mockImplementation(async (id, body) => {
        if (!body.payment) return quote(id, body);
        answers += 1;
        const wait = answers > 1 ? hold() : null;
        if (wait) await wait;
        return { ...(await quote(id, body)), invoiceable: answers > 1 ? second : ACCEPTED };
      });
      render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
      await screen.findByText('Sa séance');
      await waitFor(() => expect(invoiceBox()).toBeEnabled());
      return { asked: () => answers };
    },
    edit: () => screen.getByRole('button', { name: /Limonade/ }),
  },
  ResourceBookingDialog: {
    async open(second) {
      let answers = 0;
      api.getOccupiedSlots.mockResolvedValue({ occupiedSlots: [] });
      api.getClientPicker.mockResolvedValue({ options: [] });
      api.getProperties.mockResolvedValue([]);
      api.previewResourceBooking.mockImplementation(async (draft) => {
        if (!draft.payment) return PRICE;
        answers += 1;
        const wait = answers > 1 ? hold() : null;
        if (wait) await wait;
        return { ...PRICE, invoiceable: answers > 1 ? second : ACCEPTED };
      });
      render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
      fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
      fireEvent.click(await screen.findByRole('option', { name: '17:00' }));
      fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
      fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
      fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
      await waitFor(() => expect(invoiceBox()).toBeEnabled());
      return { asked: () => answers };
    },
    edit: () => screen.getByRole('button', { name: 'Plus 15 minutes' }),
  },
};
const CASES = Object.keys(DIALOGS).flatMap((name) => [[name, 'accepted', ACCEPTED], [name, 'refused', REFUSED]]);

beforeEach(() => { vi.clearAllMocks(); release = null; });

test.each(CASES)('%s — while the next « Facture » answer is on its way the block is pending, then the %s answer fills it', async (name, _label, second) => {
  const dialog = DIALOGS[name];
  const { asked } = await dialog.open(second);
  // The operator's own state: the box ticked (the card line ticks it), an address typed.
  expect(invoiceBox()).toBeChecked();
  fireEvent.change(streetField(), { target: { value: '12 rue' } });
  fireEvent.click(dialog.edit());
  await waitFor(() => expect(asked()).toBe(2));
  expect(invoiceBox()).toBeDisabled();
  expect(invoiceBox()).toBeChecked();
  expect(streetField()).toBeDisabled();
  expect(streetField()).toHaveValue('12 rue');
  await act(async () => { release(); });
  if (second.ok) {
    await waitFor(() => expect(invoiceBox()).toBeEnabled());
    expect(invoiceBox()).toBeChecked();
    expect(streetField()).toHaveValue('12 rue');
  } else {
    expect(await screen.findByText(second.reason)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Créer la facture dans Qonto/ })).toBeNull();
  }
});
