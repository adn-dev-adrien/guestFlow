// specs/plugins-phase-1-sdk.md rule 54 (reading 2026-11-18, loop t21 UI21-1) — a block of a sale dialog that reads a SECOND request (a quote, a
// preview of the payment typed) is drawn with the content, in a pending state of the place it takes, and the answer fills it: nothing lands under
// content already drawn. The dialogs are enumerated from the code — every file that asks a quote/preview hook and renders a sale block — and a new
// one fails here until its late blocks are in the table. Each row holds the second request, checks the pending block is there with the content,
// then releases the answer and checks the block is filled in place.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import ResourceArrivalDialog from '../../plugins/hourly-resources/ResourceArrivalDialog';
import ResourceBookingDialog from '../../plugins/hourly-resources/ResourceBookingDialog';
import StandaloneSaleDialog from '../StandaloneSaleDialog';
import { localIsoDate } from '../../plugins/hourly-resources/localDate';
import { visitPayload, fakeQuote } from '../../plugins/hourly-resources/__tests__/arrivalVisitFixtures';
import { sasPayload, stayDue, renderDialog, clickBtn } from '../../plugins/sas/__tests__/sasFixtures';
import { previewLikeTheServer } from '../../plugins/sas/__tests__/sasPreviewFake';

vi.mock('../../hooks/usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
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
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn(),
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
  },
}));

// The second request waits on `hold` until the row releases it.
let release = null;
let held = null;
const hold = () => { held = new Promise((resolve) => { release = resolve; }); };
const afterHold = (answer) => async (...args) => { await held; return answer(...args); };

const SALE_BLOCKS = ['StaySalesSection', 'SuggestedArticlesStep', 'SalePaymentLink', 'StandaloneSaleDialog', 'TenderLines', 'BookingPaymentFields', 'BookingInvoiceBlock', 'SasStayPaymentPage'];
const SRC = path.resolve(__dirname, '..', '..');
function sourcesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourcesOf(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}
const dialogs = sourcesOf(SRC)
  .filter((file) => !file.includes(`${path.sep}plugins${path.sep}sdk${path.sep}`))
  .filter((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return /\buse[A-Za-z]*(Quote|Preview)\(/.test(source) && SALE_BLOCKS.some((name) => new RegExp(`<${name}\\b`).test(source));
  })
  .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
  .sort();

const invoiceBox = () => screen.getByRole('checkbox', { name: /Créer la facture dans Qonto/ });

const RESOURCE = {
  id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60,
};
const PRICE = { total: 50, pricing: 'banded', rateGrid: 'external', durationMinutes: 60, freeMinutesApplied: 0, lines: [], vat: null, invoiceReady: true };
const CATALOGUE = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }];
const saleQuote = (body) => {
  const total = body.lines.reduce((sum, l) => sum + l.quantity * 650, 0);
  const lines = body.lines.map((l, i) => ({
    id: null, ref: `draft:${i}`, kind: 'extra', label: 'Bière locale', detail: `${l.quantity} × 6,50 €`, quantity: l.quantity, unitCents: 650, totalCents: l.quantity * 650, catalogueCents: l.quantity * 650, offered: false, status: 'due', statusLabel: 'À payer',
  }));
  return {
    document: { lines, totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 }, vatByRate: [{ rate: 20, vatCents: Math.round((total * 20) / 120) }] },
    customer: { clientId: 1, label: 'Passage', kind: 'passage' }, refusals: [], quoted: true, paymentLink: { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null },
  };
};
const PLATFORM_STAY = stayDue({
  total: 480, channel: 'platform', platformLabel: 'Booking',
  deposit: { amount: 144, applicable: true, settled: false, due: 144, owned: false, collectible: 144 },
  balance: { amount: 336, applicable: true, settled: false, due: 336, owned: false, collectible: 336 },
});

// One row per late block of each dialog: `open` mounts the dialog with the second request held and goes to the block, `pending` checks the block
// is drawn with the content, `filled` checks the answer filled it.
const DIALOGS = {
  'plugins/hourly-resources/ResourceArrivalDialog.jsx': [{
    block: '« Facture » of « Payé maintenant »',
    open: async () => {
      const quote = fakeQuote();
      api.getResourceVisit.mockResolvedValue(visitPayload());
      api.quoteResourceVisit.mockImplementation(async (id, body) => (body.payment ? afterHold(quote)(id, body) : quote(id, body)));
      render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
      await screen.findByText('Sa séance');
    },
    pending: () => {
      expect(screen.getByText('Facture')).toBeInTheDocument();
      expect(invoiceBox()).toBeDisabled();
      expect(invoiceBox()).toBeChecked();
      expect(screen.getByText('Adresse de facturation · facultative')).toBeInTheDocument();
    },
    filled: async () => {
      await waitFor(() => expect(invoiceBox()).toBeEnabled());
      expect(invoiceBox()).toBeChecked();
    },
  }],
  'plugins/hourly-resources/ResourceBookingDialog.jsx': [{
    block: '« Facture » of « Maintenant »',
    open: async () => {
      api.getOccupiedSlots.mockResolvedValue({ occupiedSlots: [] });
      api.getClientPicker.mockResolvedValue({ options: [] });
      api.getProperties.mockResolvedValue([]);
      api.previewResourceBooking.mockImplementation(async (draft) => (draft.payment ? afterHold(() => ({ ...PRICE, invoiceable: { ok: true, code: null, reason: null } }))() : PRICE));
      render(<ResourceBookingDialog open resource={RESOURCE} initialDate={localIsoDate()} booking={null} onClose={() => {}} onSave={vi.fn()} onDelete={() => {}} />);
      fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
      fireEvent.click(await screen.findByRole('option', { name: '17:00' }));
      fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
      fireEvent.click(await screen.findByRole('option', { name: '18:00' }));
      fireEvent.change(screen.getByRole('textbox', { name: /Nom du client/ }), { target: { value: 'Alex Exemple' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Maintenant' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
      await screen.findByText('Facture');
    },
    pending: () => {
      expect(screen.queryByText('La facture se propose une fois le paiement saisi.')).toBeNull();
      expect(invoiceBox()).toBeDisabled();
      expect(invoiceBox()).toBeChecked();
    },
    filled: async () => {
      await waitFor(() => expect(invoiceBox()).toBeEnabled());
    },
  }],
  'plugins/sas/ReservationSasDialog.jsx': [{
    block: '« Séjour à régler » (the stay page reads the preview)',
    open: async () => {
      api.getReservationWeatherAlerts.mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] });
      api.getReservationSas.mockResolvedValue(sasPayload({ cleaning: { included: true, price: 80 }, reservation: { cautionAmount: 0 }, stayPayment: PLATFORM_STAY }));
      api.previewArrivalSas.mockImplementation(afterHold(previewLikeTheServer(api)));
      renderDialog({ mode: 'arrival' });
      await screen.findByText('Commencer');
      clickBtn('Commencer');
      await screen.findByText('Séjour à régler :');
    },
    pending: () => {
      expect(screen.getByText(/Ce solde est versé par la plateforme/)).toBeInTheDocument();
      expect(screen.getByText('Acompte : —')).toBeInTheDocument();
      expect(screen.getByText('Solde : —')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    },
    filled: async () => {
      expect(await screen.findByText('480,00 €')).toBeInTheDocument();
      expect(screen.getByText('Acompte : 144,00 €')).toBeInTheDocument();
      expect(screen.getByText('Solde : 336,00 €')).toBeInTheDocument();
    },
  }],
  'components/StandaloneSaleDialog.jsx': [{
    block: '« Total » of the first article',
    open: async () => {
      api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: CATALOGUE });
      api.quoteStandaloneSale.mockImplementation(afterHold(saleQuote));
      render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
      await waitFor(() => expect(api.quoteStandaloneSale).toHaveBeenCalled());
    },
    pending: () => {
      expect(within(screen.getByRole('dialog')).getByText('Total')).toBeInTheDocument();
      expect(screen.getByTestId('sale-total')).toHaveTextContent('—');
    },
    filled: async () => {
      await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50 €'));
    },
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  hold();
});

test('the dialogs enumerated from the code are exactly the table', () => {
  expect(dialogs).toEqual(Object.keys(DIALOGS).sort());
});

describe.each(Object.keys(DIALOGS))('%s', (file) => {
  test.each(DIALOGS[file].map((row) => [row.block, row]))('%s: drawn pending with the content, then filled in place', async (_, row) => {
    await row.open();
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    row.pending();
    release();
    await row.filled();
  });
});
