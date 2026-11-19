// specs/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-19, loop t26 UI26-1) — a field that decides no amount (an e-mail, a name, a
// reason, « Enregistrer comme client ») never disables a money preview nor makes it refuse: typed key by key, it leaves the figures, the
// payment and the typed tender lines on screen. Every screen that previews through the hook (enumerated from the code below) has its row:
// the fields typed on it, or why none of its fields reaches the preview. A screen added to that list fails here until it has its row.
import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import StandaloneSaleDialog, { quoteCustomerOf } from '../../components/StandaloneSaleDialog';
import DialogProvider from '../../components/DialogProvider';
import PlatformPenaltyDialog from '../../components/reservation/PlatformPenaltyDialog';
import resourceBookingDraft from '../../plugins/hourly-resources/resourceBookingDraft';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
    listPlatformPenalties: vi.fn(() => Promise.resolve({ items: [], suggestions: [] })),
    previewPlatformPenalty: vi.fn(),
    declarePlatformPenalty: vi.fn(),
  },
}));
vi.mock('../usePlugins', () => ({ usePlugin: () => true }));

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const SRC = path.resolve(__dirname, '..', '..');
const HOOKS = ['useLatestPreview', 'useVisitQuote', 'useResourceBookingPreview', 'useSasRecapPreview'];
function filesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : filesOf(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}
const CONSUMERS = filesOf(SRC)
  .filter((f) => !HOOKS.includes(path.basename(f).replace(/\.jsx?$/, '')))
  .filter((f) => HOOKS.some((hook) => new RegExp(`\\b${hook}\\(`).test(fs.readFileSync(f, 'utf8'))))
  .map((f) => path.basename(f).replace(/\.jsx?$/, ''))
  .sort();

// --- the counter ----------------------------------------------------------------------------------------------------------------------

const BEER = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }];
const counterQuote = (body, { linkReady }) => {
  const total = body.lines.reduce((sum, e) => sum + e.quantity * 650, 0);
  const email = body.customer && body.customer.email ? body.customer.email : null;
  return {
    document: {
      lines: body.lines.map((e, i) => ({
        id: null, ref: `draft:${i}`, kind: 'extra', label: 'Bière locale', detail: `${e.quantity} × 6,50 €`, quantity: e.quantity, unitCents: 650,
        totalCents: e.quantity * 650, catalogueCents: e.quantity * 650, offered: false, status: 'due', statusLabel: 'À payer',
      })),
      totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 },
      vatByRate: [{ rate: 20, vatCents: Math.round(total / 6) }],
    },
    customer: { clientId: null, label: 'Passage', kind: 'passage' },
    refusals: [],
    paymentLink: linkReady
      ? { available: Boolean(email), reason: email ? null : 'NO_EMAIL', email, open: null }
      : { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null },
  };
};
// The server's own customer checks (server/src/utils/standaloneSale.js): an address that is not one, or « Enregistrer comme client »
// without a name, is refused — so the mock refuses them too, and a screen that sent them would lose its amount.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const refusalOf = (customer = {}) => {
  if (customer.email && !EMAIL.test(customer.email)) return Object.assign(new Error('Adresse e-mail invalide.'), { status: 400 });
  if (customer.registerAsClient && !customer.name) return Object.assign(new Error('Un nom pour enregistrer le client.'), { status: 400 });
  return null;
};
async function openCounter({ linkReady = false } = {}) {
  api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: BEER });
  api.quoteStandaloneSale.mockImplementation(async (body) => {
    const refusal = refusalOf(body.customer);
    if (refusal) throw refusal;
    return counterQuote(body, { linkReady });
  });
  render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
  await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50'));
}
const amounts = () => [...document.querySelectorAll('[data-tender-amount]')].map((input) => input.value);
const methods = () => [...document.querySelectorAll('[data-tender-line] select')].map((select) => select.value);
// CB 2 + Espèces 4,50 typed by the operator.
async function typeSplit() {
  await waitFor(() => expect(amounts()).toHaveLength(1));
  fireEvent.change(document.querySelector('[data-tender-amount="0"]'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un moyen' }));
  await waitFor(() => expect(amounts()).toHaveLength(2));
  fireEvent.change(document.querySelector('[data-tender-amount="1"]'), { target: { value: '4,50' } });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Enregistrer la vente · encaisser 6,50/ })).toBeEnabled());
}
const keystrokes = (text) => [...text].map((_, i) => text.slice(0, i + 1));

// Each row: `open()` reaches an accepted answer with what the operator typed; `fields` are the non-amount fields, each a list of
// successive values typed key by key; `type(field, value)`; `unchanged(state)` checks, at every keystroke, that nothing the answer drew went.
const COUNTER_FIELDS = {
  'E-mail': [...keystrokes('client@exemple.fr'), 'client@exemple.f', 'client@'],
  Nom: keystrokes('Martin'),
};
const typeCounterField = (field, value) => fireEvent.change(screen.getByLabelText(field), { target: { value } });
const ROWS = {
  'StandaloneSaleDialog — « Encaisser maintenant » with typed lines': {
    async open(state) { await openCounter(); await typeSplit(); state.methods = methods(); state.amounts = amounts(); },
    fields: COUNTER_FIELDS,
    type: typeCounterField,
    unchanged(state) {
      expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50');
      expect(methods()).toEqual(state.methods);
      expect(amounts()).toEqual(state.amounts);
      expect(screen.getByRole('button', { name: /^Enregistrer la vente · encaisser 6,50/ })).toBeInTheDocument();
    },
  },
  'StandaloneSaleDialog — « Enregistrer comme client » without a name': {
    async open(state) { await openCounter(); await typeSplit(); state.methods = methods(); state.amounts = amounts(); },
    fields: { 'Enregistrer comme client': [true, false, true] },
    type(field, value) {
      const box = screen.getByRole('checkbox', { name: field });
      if (box.checked !== value) fireEvent.click(box);
    },
    unchanged(state) {
      expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50');
      expect(amounts()).toEqual(state.amounts);
      expect(screen.queryByText('Montant indisponible.')).toBeNull();
    },
  },
  'StandaloneSaleDialog — « Envoyer un lien »': {
    async open() {
      await openCounter({ linkReady: true });
      fireEvent.click(await screen.findByRole('button', { name: 'Envoyer un lien' }));
      await screen.findByText('Adresse e-mail requise.');
    },
    fields: { 'E-mail': keystrokes('client@exemple.fr') },
    type: typeCounterField,
    unchanged() {
      expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50');
      expect(screen.getByRole('button', { name: 'Encaisser maintenant' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Envoyer un lien' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Le lien se crée à l’enregistrement.')).toBeInTheDocument();
    },
  },
  'PlatformPenaltyDialog — « Motif »': {
    async open() {
      api.previewPlatformPenalty.mockImplementation(async (id, body) => ({
        valid: Boolean(body.reason), needsChoice: false, warnings: [], errors: [],
        before: { payout: 570.02, commission: 229.98, netReceived: 570.02 },
        after: { payout: 610.02, commission: Math.round((229.98 - body.amount) * 100) / 100, netReceived: 570.02 },
      }));
      render(<DialogProvider><PlatformPenaltyDialog open onClose={() => {}} reservationId={7} source="fiche" onDone={() => {}} initialAmount={40} /></DialogProvider>);
      await screen.findByText(/Commission 229,98 € → 189,98 €/);
    },
    fields: { Motif: keystrokes('Annulation') },
    type(field, value) { fireEvent.change(screen.getByLabelText(field), { target: { value } }); },
    unchanged() { expect(screen.getByText(/Commission 229,98 € → 189,98 €/)).toBeInTheDocument(); },
  },
};
// Screens on which no field that decides no amount reaches the preview's draft or its `enabled`.
const NO_SUCH_FIELD = {
  MidStayNoteDialog: 'its draft is the ticked keys, the opening and the live remainder: every input of the dialog changes the amount',
  ResourceArrivalDialog: 'the draft is the offered time and the extras (the invoice address, the notes are never in it — rule 9)',
  ResourceBookingDialog: 'resourceBookingDraft keeps the price-relevant fields only (checked below)',
  ReservationSasDialog: 'buildArrivalDraft / buildDepartureDraft hold the check-in / check-out decisions only; no free-text field on the money pages',
  SplitSharesDialog: 'its only inputs are the shares (amounts)',
  LinkTransactionDialog: 'the search box feeds the list preview, not the split; the split draft is the ticked transfers or the shares',
};
const ROW_SCREENS = [...new Set(Object.keys(ROWS).map((name) => name.split(' — ')[0]))];

test('every screen that previews through the hook, read from the code, has its non-amount fields typed here or says why none', () => {
  expect(CONSUMERS).toEqual([...ROW_SCREENS, ...Object.keys(NO_SUCH_FIELD)].sort());
});

const CASES = Object.entries(ROWS).flatMap(([name, row]) => Object.keys(row.fields).map((field) => [name, field]));
test.each(CASES)('%s: « %s » typed key by key keeps the figures and the typed lines at every keystroke', async (name, field) => {
  const row = ROWS[name];
  const state = {};
  await row.open(state);
  for (const value of row.fields[field]) {
    act(() => { row.type(field, value); });
    row.unchanged(state);
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await pause(250); });
    row.unchanged(state);
  }
});

test('the counter sends what the server takes as typed: an address once it is one, « Enregistrer comme client » once a name is there', () => {
  expect(quoteCustomerOf({ email: 'client@' })).toEqual({});
  expect(quoteCustomerOf({ email: ' client@exemple.fr ' })).toEqual({ email: 'client@exemple.fr' });
  expect(quoteCustomerOf({ register: true })).toEqual({});
  expect(quoteCustomerOf({ register: true, name: ' Martin ' })).toEqual({ name: 'Martin', registerAsClient: true });
  expect(quoteCustomerOf({ clientId: 4, email: 'client@', name: 'x' })).toEqual({ clientId: 4 });
});

test('the booking draft holds the price-relevant fields only', () => {
  const draft = resourceBookingDraft({
    resourceId: 3, bookingId: null, date: '2099-02-13', startTime: '18:00', endTime: '20:00', propertyId: 1, offeredMinutes: 30,
    clientName: 'Martin', phone: '0600000000', notes: 'n', email: 'client@exemple.fr',
  });
  expect(Object.keys(draft).sort()).toEqual(['bookingId', 'date', 'endTime', 'offeredMinutes', 'propertyId', 'resourceId', 'startTime']);
});
