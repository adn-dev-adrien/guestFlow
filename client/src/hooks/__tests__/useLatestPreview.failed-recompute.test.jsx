// specs/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-18, loop t23 S23-1) — a recompute that FAILS after an earlier answer leaves no
// figure of that answer on screen and no money control set from it: `useLatestPreview` turns `data` null and `failed` true until a new
// answer, and every screen that previews money through it (enumerated from the code below) shows the reason with « Réessayer », keeps its
// commit disabled, and draws the new answer once « Réessayer » brings it. A screen added to that list fails here until it has its row.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import useLatestPreview from '../useLatestPreview';
import StandaloneSaleDialog from '../../components/StandaloneSaleDialog';
import DialogProvider from '../../components/DialogProvider';
import PlatformPenaltyDialog from '../../components/reservation/PlatformPenaltyDialog';
import ResourceArrivalDialog from '../../plugins/hourly-resources/ResourceArrivalDialog';
import ResourceBookingDialog from '../../plugins/hourly-resources/ResourceBookingDialog';
import SplitSharesDialog from '../../plugins/online-payment/SplitSharesDialog';
import LinkTransactionDialog from '../../plugins/online-payment/LinkTransactionDialog';
import { visitPayload, fakeQuote } from '../../plugins/hourly-resources/__tests__/arrivalVisitFixtures';
import { ficheCreditsPayload, previewPayload } from '../../plugins/online-payment/__tests__/reconciliationFixtures';
import {
  sasPayload, stayDue, renderDialog as renderSas, clickBtn, stayPageReady,
} from '../../plugins/sas/__tests__/sasFixtures';
import { recapFor } from '../../plugins/sas/__tests__/sasPreviewFake';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
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
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn(() => Promise.resolve({ configured: false, resolved: false, department: null, alerts: [] })),
    listPlatformPenalties: vi.fn(() => Promise.resolve({ items: [], suggestions: [] })),
    previewPlatformPenalty: vi.fn(),
    declarePlatformPenalty: vi.fn(),
    previewReconciliationAllocation: vi.fn(),
    getReconciliationFicheCredits: vi.fn(),
    getReconciliationCandidates: vi.fn(),
  },
}));
vi.mock('../usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../usePlugins', () => ({ usePlugin: () => true }));

const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const retry = () => fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
// No money field set from an answer may stay live on an unknown amount (a tender amount, « Montant CB »…). The draft's own inputs — what
// the operator types to be priced (the penalty's amount) — stay editable: they are the request, not a figure of the answer.
const labelOf = (input) => input.getAttribute('aria-label') || input.labels?.[0]?.textContent || '';
const liveMoneyFields = (draftInputs = []) => screen.queryAllByRole('textbox')
  .filter((input) => !input.disabled && /montant/i.test(labelOf(input)) && !draftInputs.includes(labelOf(input)));

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

const BEER = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' }];
const counterQuote = (lines) => {
  const priced = lines.map((e, i) => ({
    id: null, ref: `draft:${i}`, kind: 'extra', label: 'Bière locale', detail: `${e.quantity} × 6,50 €`, quantity: e.quantity, unitCents: 650,
    totalCents: e.quantity * 650, catalogueCents: e.quantity * 650, offered: false, status: 'due', statusLabel: 'À payer',
  }));
  const total = priced.reduce((sum, l) => sum + l.totalCents, 0);
  return {
    document: { lines: priced, totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 }, vatByRate: [{ rate: 20, vatCents: Math.round(total / 6) }] },
    customer: { clientId: null, label: 'Passage', kind: 'passage' },
    refusals: [],
    paymentLink: { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null },
  };
};
const RESOURCE = { id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60 };
const BOOKING = { id: 9, date: '2099-02-13', startTime: '18:00', endTime: '20:00', clientName: 'X', notes: '', paid: false };
const bookingPrice = (total) => ({ total, pricing: 'banded', rateGrid: 'external', durationMinutes: 120, freeMinutesApplied: 0, billedMinutes: 120, grossTotal: total, bands: [], freeValue: 0, lines: [], vat: null });
const PROPOSAL = {
  id: 'p:7|balance,8|balance', bank: { transactionId: 'p', amountCents: 70000, dateLabel: '15/10' },
  pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41800 }, { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25100 }],
};
const FIGURES = (commission) => ({ valid: true, needsChoice: false, warnings: [], errors: [], before: { payout: 570.02, commission: 229.98, netReceived: 570.02 }, after: { payout: 610.02, commission, netReceived: 570.02 } });
const SAS_STAY = sasPayload({
  reservation: { cautionAmount: 0, complementAmount: 20, options: [{ optionId: 5, title: 'Panier gourmand', inComplement: 1, offered: 0, totalPrice: 20, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1 }] },
  cleaning: { included: true, price: 80 },
  stayPayment: stayDue(),
});

// Each row: `answer()` reaches a first accepted answer, `fail()` makes the next request fail and triggers it, `stale` matches what the first
// answer drew, `check()` the row's own placeholders and disabled controls, `recover()` the new answer once « Réessayer » brings it.
const ROWS = {
  StandaloneSaleDialog: {
    async answer(state) {
      api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: BEER });
      api.quoteStandaloneSale.mockImplementation(async (body) => { if (state.fail) throw offline(); return counterQuote(body.lines); });
      render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
      await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50'));
    },
    async fail(state) { state.fail = true; fireEvent.click(screen.getByRole('button', { name: /Bière locale/ })); await screen.findByText('Service indisponible'); },
    stale: /× 6,50 €|encaisser 6,50/,
    check() {
      expect(screen.getByTestId('sale-total')).toHaveTextContent('—');
      expect(screen.getByRole('button', { name: /^Enregistrer la vente/ })).toBeDisabled();
    },
    async recover() { await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('13,00')); },
  },
  ResourceArrivalDialog: {
    async answer(state) {
      api.getResourceVisit.mockResolvedValue(visitPayload());
      const real = fakeQuote();
      api.quoteResourceVisit.mockImplementation(async (id, body, options) => { if (state.fail) throw offline(); return real(id, body, options); });
      render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));
      await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('126,50'));
      await pause(300);
    },
    async fail(state) { state.fail = true; fireEvent.click(screen.getByRole('button', { name: /Bière locale/ })); await screen.findByText('Service indisponible'); await pause(300); },
    stale: /126,50|× 6,50 €/,
    check() {
      expect(screen.getByTestId('remaining')).toHaveTextContent('—');
      expect(screen.getByRole('button', { name: 'Valider l’arrivée' })).toBeDisabled();
    },
    async recover() { await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('133,00')); },
  },
  ResourceBookingDialog: {
    async answer(state) {
      api.previewResourceBooking.mockImplementation(async () => { if (state.fail) throw offline(); return bookingPrice(state.total || 70); });
      render(<ResourceBookingDialog open resource={RESOURCE} booking={BOOKING} onClose={() => {}} onSave={() => {}} onDelete={() => {}} />);
      await screen.findAllByText(/70,00 €/);
    },
    async fail(state) {
      state.fail = true;
      fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
      fireEvent.click(await screen.findByRole('option', { name: '19:00' }));
      await screen.findByText(/Prix indisponible/);
    },
    stale: /70,00 €/,
    check() { expect(screen.getByRole('button', { name: /^Enregistrer/ })).toBeDisabled(); },
    async recover(state) { state.total = 35; await screen.findAllByText(/35,00 €/); },
    beforeRetry(state) { state.total = 35; },
  },
  ReservationSasDialog: {
    async answer(state) {
      api.getReservationSas.mockResolvedValue(SAS_STAY);
      api.previewArrivalSas.mockImplementation(async (id, draft) => { if (state.fail) throw offline(); return recapFor(SAS_STAY, draft); });
      renderSas({ mode: 'arrival' });
      await screen.findByText('Commencer');
      clickBtn('Commencer');
      for (let i = 0; i < 12 && !screen.queryByText(/Récapitulatif — /); i += 1) {
        if (screen.queryByText('Séjour à régler :')) await stayPageReady();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Suivant' })).toBeEnabled());
        clickBtn('Suivant');
        await pause(50);
      }
      await waitFor(() => expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeEnabled());
      // « Régler séparément »: the stay is settled by its own buttons, under « Règlement du séjour » (the member the reviewer found live).
      fireEvent.click(screen.getByRole('button', { name: /Régler séparément/ }));
      await screen.findByText('Règlement du séjour');
    },
    async fail(state) { state.fail = true; fireEvent.click(screen.getAllByRole('button', { name: 'Offrir' })[0]); await screen.findByText(/Total indisponible/); },
    stale: null,
    check() {
      expect(screen.getAllByText(/^Séjour : /).map((n) => n.textContent)).toEqual(['Séjour : —']);
      const box = screen.getByText('Règlement du séjour').nextElementSibling;
      const buttons = [...box.querySelectorAll('button')];
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((b) => expect(b).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
    },
    async recover() { await waitFor(() => expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeEnabled()); },
  },
  PlatformPenaltyDialog: {
    async answer(state) {
      api.previewPlatformPenalty.mockImplementation(async () => { if (state.fail) throw offline(); return FIGURES(state.commission || 189.98); });
      render(<DialogProvider><PlatformPenaltyDialog open onClose={() => {}} reservationId={7} source="fiche" onDone={() => {}} initialAmount={40} /></DialogProvider>);
      await screen.findByText(/Commission 229,98 € → 189,98 €/);
    },
    async fail(state) { state.fail = true; fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: '50' } }); await screen.findByText('Service indisponible'); },
    stale: /189,98/,
    draftInputs: ['Montant (€)'],
    check() { expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled(); },
    beforeRetry(state) { state.commission = 179.98; },
    async recover() { await screen.findByText(/Commission 229,98 € → 179,98 €/); },
  },
  SplitSharesDialog: {
    async answer(state) {
      api.previewReconciliationAllocation.mockImplementation(async () => {
        if (state.fail) throw offline();
        return previewPayload({ valid: false, errors: [{ code: 'SHARES_DO_NOT_SUM', field: 'shares', message: state.message || 'Il manque 9,00 € : les parts doivent faire 700,00 €.' }] });
      });
      render(<SplitSharesDialog open onClose={() => {}} onSubmit={() => {}} proposal={PROPOSAL} labels={{ '7|balance': 'Séjour 7', '8|balance': 'Séjour 8' }} />);
      await screen.findByText(/Il manque 9,00 €/);
    },
    async fail(state) { state.fail = true; fireEvent.change(screen.getByLabelText('Séjour 8 (€)'), { target: { value: '252,00' } }); await screen.findByText('Service indisponible'); },
    stale: /Il manque 9,00 €/,
    check() { expect(screen.getByRole('button', { name: 'Répartir et confirmer' })).toBeDisabled(); },
    beforeRetry(state) { state.message = 'Il manque 8,00 € : les parts doivent faire 700,00 €.'; },
    async recover() { await screen.findByText(/Il manque 8,00 €/); },
  },
  LinkTransactionDialog: {
    async answer(state) {
      api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
      api.previewReconciliationAllocation.mockImplementation(async () => { if (state.fail) throw offline(); return previewPayload(state.summary ? { summaryLabel: state.summary } : {}); });
      render(<LinkTransactionDialog open onClose={() => {}} onSubmit={() => {}} reservationId={7} />);
      fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
      await screen.findByText('1 virement · 300,00 €');
    },
    async fail(state) { state.fail = true; fireEvent.click(screen.getAllByRole('checkbox')[1]); await screen.findByText(/Service indisponible/); },
    stale: /1 virement · 300,00 €/,
    check() { expect(screen.getByRole('button', { name: 'Rattacher' })).toBeDisabled(); },
    beforeRetry(state) { state.summary = '2 virements · 450,00 €'; },
    async recover() { await screen.findByText('2 virements · 450,00 €'); },
  },
};

beforeEach(() => { window.innerWidth = 1280; });

test('the hook: a failed request makes the answer unknown until a new one, through a pending « Réessayer »', async () => {
  let fail = false;
  let release;
  const fetcher = vi.fn((draft) => (fail ? Promise.reject(offline()) : new Promise((resolve) => { release = () => resolve({ n: draft.n }); })));
  const { result, rerender } = renderHook(({ n }) => useLatestPreview({ fetcher, draft: { n }, enabled: true, delay: 0 }), { initialProps: { n: 1 } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => { release(); });
  expect(result.current).toMatchObject({ data: { n: 1 }, last: { n: 1 }, failed: false, fresh: true });
  fail = true;
  rerender({ n: 2 });
  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current).toMatchObject({ data: null, last: { n: 1 }, failed: true, fresh: false, pending: false });
  fail = false;
  act(() => { result.current.retry(); });
  expect(result.current).toMatchObject({ data: null, failed: true, pending: true, error: null });
  await act(async () => { release(); });
  expect(result.current).toMatchObject({ data: { n: 2 }, last: { n: 2 }, failed: false, fresh: true });
});

test('every screen that previews money through the hook, read from the code, has its row', () => {
  expect(CONSUMERS).toEqual(Object.keys(ROWS).sort());
});

test.each(Object.keys(ROWS))('%s — a recompute that fails after an answer: no figure of that answer, no live money field, reason + « Réessayer », then the new answer', async (name) => {
  const row = ROWS[name];
  const state = {};
  await row.answer(state);
  await row.fail(state);
  if (row.stale) expect(screen.queryAllByText(row.stale)).toHaveLength(0);
  expect(liveMoneyFields(row.draftInputs)).toHaveLength(0);
  row.check();
  state.fail = false;
  if (row.beforeRetry) row.beforeRetry(state);
  retry();
  await row.recover(state);
});
