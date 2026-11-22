// specs/plugins-phase-1-sdk.md rule 54 (reading 2026-11-18, loop t24), specs/outside-booking-sas.md rule 54 (reading 2026-11-18, loop t24) —
// on the nominal path a commit button keeps a stable label through a pending edit: it never falls back to a plainer wording (« Enregistrer »
// instead of « Enregistrer et facturer ») while a newer answer is on its way. The root was a second question asked for a STALE pair — the
// edited draft with the payment still typed against the older price — whose answer was a false refusal (« Les moyens font 50,00 € pour
// 37,50 € dus. »). The invoice question now waits for the price of the draft on screen and the tenders that follow it. Every screen that
// previews through `useLatestPreview` (read from the code) either has a row here, or is listed in STATIC_LABELS with why its label cannot
// fall back.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import ResourceArrivalDialog from '../../plugins/hourly-resources/ResourceArrivalDialog';
import ResourceBookingDialog from '../../plugins/hourly-resources/ResourceBookingDialog';
import StandaloneSaleDialog from '../StandaloneSaleDialog';
import { visitPayload, fakeQuote } from '../../plugins/hourly-resources/__tests__/arrivalVisitFixtures';

vi.mock('../../hooks/usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
    getOccupiedSlots: vi.fn(() => Promise.resolve({ occupiedSlots: [] })),
    getClientPicker: vi.fn(() => Promise.resolve({ options: [] })),
    getProperties: vi.fn(() => Promise.resolve([])),
    previewResourceBooking: vi.fn(),
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
  },
}));

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

// Screens whose commit label is not a decision read from an answer.
const STATIC_LABELS = {
  PlatformPenaltyDialog: 'fixed « Enregistrer »',
  CampaignEditor: 'its commit is the page bar’s « Enregistrer », whose label never changes; the price decides nothing it saves',
  NewVoucherPage: 'fixed « Créer le bon » / « Envoyer le lien »: the label follows the outcome chosen, never the answer',
  AddProductDialog: 'fixed « Ajouter » (loop t26 verifier)',
  SplitSharesDialog: 'fixed « Répartir et confirmer »',
  LinkTransactionDialog: 'fixed « Rattacher »',
  ReservationSasDialog: '« Calcul du total… » while the recap is asked, then « Valider et terminer » or the amount its own tender lines collect',
  MidStayNoteDialog: 'fixed « CB / Chèque » / « Caisse interne »; « Encaisser … » keeps the latest total through a recompute (`data` kept while asked), « — » only on a failure (loop t26 UI26-2)',
};

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sumOf = (payment) => (payment ? payment.tenders.reduce((sum, t) => sum + t.amountCents, 0) : 0);
const refusalFor = (sum, due) => ({ ok: false, code: 'TENDERS_INVALID', reason: `Les moyens font ${sum} pour ${due} dus.`, silent: false });

// Every label the commit button shows, and every false refusal drawn, from the edit to the settled answer.
function watch(button) {
  const seen = { labels: new Set(), refusals: 0 };
  const read = () => {
    const control = button();
    if (control) seen.labels.add(control.textContent.trim());
    if (/Les moyens font/.test(document.body.textContent)) seen.refusals += 1;
  };
  const observer = new MutationObserver(read);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  read();
  return { seen, stop: () => observer.disconnect() };
}

const RESOURCE = { id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60 };
const BOOKING = { id: 9, date: '2099-02-13', startTime: '18:00', endTime: '20:00', clientName: 'X', notes: '', paid: false };
const bookingPrice = (total) => ({ total, pricing: 'banded', rateGrid: 'external', durationMinutes: 120, freeMinutesApplied: 0, billedMinutes: 120, grossTotal: total, bands: [], freeValue: 0, lines: [], vat: null, invoiceReady: true });
const BEER = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }];
const counterQuote = (lines) => {
  const total = lines.reduce((sum, e) => sum + e.quantity * 650, 0);
  return {
    document: {
      lines: lines.map((e, i) => ({ id: null, ref: `draft:${i}`, kind: 'extra', label: 'Bière locale', detail: `${e.quantity} × 6,50 €`, quantity: e.quantity, unitCents: 650, totalCents: e.quantity * 650, catalogueCents: e.quantity * 650, offered: false, status: 'due', statusLabel: 'À payer' })),
      totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 },
      vatByRate: [{ rate: 20, vatCents: Math.round(total / 6) }],
    },
    customer: { clientId: null, label: 'Passage', kind: 'passage' },
    refusals: [],
    paymentLink: { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null },
  };
};

// The payment's question answers a little faster than the price, as measured in Chromium (both leave together; loop t24 booking-why).
// Each row: `open()` reaches a settled answer with a payment typed, `edit()` changes the draft, `settled()` waits for the new answer,
// `labels` the only labels allowed on the way.
const ROWS = {
  ResourceBookingDialog: {
    button: () => screen.queryByRole('button', { name: /^(Enregistrer|Calcul du prix)/ }),
    async open() {
      api.previewResourceBooking.mockImplementation(async (draft) => {
        await pause(draft.payment ? 20 : 40);
        const total = 70 - ((draft.offeredMinutes || 0) / 15) * 5;
        if (!draft.payment) return bookingPrice(total);
        const sum = sumOf(draft.payment);
        return { ...bookingPrice(total), invoiceable: sum === total * 100 ? { ok: true, code: null, reason: null } : refusalFor(sum, total * 100) };
      });
      render(<ResourceBookingDialog open resource={RESOURCE} booking={BOOKING} onClose={() => {}} onSave={() => {}} onDelete={() => {}} />);
      await screen.findAllByText(/70,00 €/);
      fireEvent.click(screen.getByRole('button', { name: 'Maintenant' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer et facturer' })).toBeEnabled());
    },
    edit() { fireEvent.click(screen.getByRole('button', { name: 'Plus 15 minutes' })); },
    async settled() {
      await waitFor(() => expect(api.previewResourceBooking.mock.calls.some(([d]) => d.payment && sumOf(d.payment) === 6500)).toBe(true));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer et facturer' })).toBeEnabled());
    },
    labels: ['Calcul du prix…', 'Enregistrer et facturer'],
  },
  ResourceArrivalDialog: {
    button: () => screen.queryByRole('button', { name: /^(Valider l’arrivée|Enregistrer|Fermer)/ }),
    async open() {
      api.getResourceVisit.mockResolvedValue(visitPayload());
      const real = fakeQuote();
      api.quoteResourceVisit.mockImplementation(async (id, body, options) => {
        await pause(body.payment ? 20 : 120);
        const answer = await real(id, body, options);
        if (!body.payment) return answer;
        const sum = sumOf(body.payment);
        const due = answer.totals.remainingCents;
        return { ...answer, invoiceable: sum === due ? { ok: true, code: null, reason: null } : refusalFor(sum, due) };
      });
      render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
      await waitFor(() => expect(screen.getByRole('checkbox', { name: /Créer la facture dans Qonto/ })).toBeEnabled());
    },
    edit() { fireEvent.click(screen.getByRole('button', { name: /Bière locale/ })); },
    async settled() {
      await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('126,50'));
      await waitFor(() => expect(api.quoteResourceVisit.mock.calls.some(([, b]) => b.payment && sumOf(b.payment) === 12650)).toBe(true));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeEnabled());
    },
    labels: ['Valider l’arrivée'],
  },
  StandaloneSaleDialog: {
    button: () => screen.queryByRole('button', { name: /^Enregistrer la vente/ }),
    async open() {
      api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: BEER });
      api.quoteStandaloneSale.mockImplementation(async (body) => { await pause(30); return counterQuote(body.lines); });
      render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^Enregistrer la vente · encaisser 6,50/ })).toBeEnabled());
    },
    edit() { fireEvent.click(screen.getByRole('button', { name: /Bière locale/ })); },
    async settled() { await waitFor(() => expect(screen.getByRole('button', { name: /^Enregistrer la vente · encaisser 13,00/ })).toBeEnabled()); },
    labels: ['Enregistrer la vente · encaisser 6,50 €', 'Enregistrer la vente · encaisser 13,00 €'],
  },
};

beforeEach(() => { vi.clearAllMocks(); window.innerWidth = 1280; });

test('every screen that previews through the hook, read from the code, has a row or a fixed label', () => {
  expect(CONSUMERS).toEqual([...Object.keys(ROWS), ...Object.keys(STATIC_LABELS)].sort());
});

test.each(Object.keys(ROWS))('%s — the commit label stays stable through a pending edit, and no false refusal is drawn', async (name) => {
  const row = ROWS[name];
  await row.open();
  const { seen, stop } = watch(row.button);
  row.edit();
  await row.settled();
  await pause(100);
  stop();
  expect([...seen.labels].filter((label) => !row.labels.includes(label))).toEqual([]);
  expect(seen.refusals).toBe(0);
});
