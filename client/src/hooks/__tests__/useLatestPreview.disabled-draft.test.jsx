// specs/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-19, loop t25 UI25-1) — a draft that cannot be asked (`enabled` false: an
// e-mail being typed, an amount emptied or unreadable) holds no answer of its own: `useLatestPreview` gives `data` null unless the latest
// answer is for the draft on screen, failed or not, so no screen draws an older draft's figures as current. Every screen that previews
// through the hook (enumerated from the code below) is either a member — its draft stays on screen while it cannot be asked, and it shows
// its placeholders — or says why it is not. A screen added to that list fails here until it has its row.
import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  act, fireEvent, render, renderHook, screen, waitFor,
} from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../api';
import useLatestPreview from '../useLatestPreview';
import StandaloneSaleDialog from '../../components/StandaloneSaleDialog';
import DialogProvider from '../../components/DialogProvider';
import PlatformPenaltyDialog from '../../components/reservation/PlatformPenaltyDialog';
import SplitSharesDialog from '../../plugins/online-payment/SplitSharesDialog';
import LinkTransactionDialog from '../../plugins/online-payment/LinkTransactionDialog';
import { ficheCreditsPayload, previewPayload } from '../../plugins/online-payment/__tests__/reconciliationFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
    listPlatformPenalties: vi.fn(() => Promise.resolve({ items: [], suggestions: [] })),
    previewPlatformPenalty: vi.fn(),
    declarePlatformPenalty: vi.fn(),
    previewReconciliationAllocation: vi.fn(),
    getReconciliationFicheCredits: vi.fn(),
    getReconciliationCandidates: vi.fn(),
  },
}));
vi.mock('../usePlugins', () => ({ usePlugin: () => true }));

const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });
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

// --- the hook --------------------------------------------------------------------------------------------------------------------------

const harness = () => {
  const outcome = { fail: false };
  const releases = [];
  const fetcher = vi.fn((draft) => (outcome.fail
    ? Promise.reject(offline())
    : new Promise((resolve) => { releases.push(() => resolve({ n: draft.n })); })));
  const view = renderHook(({ n, enabled = true }) => useLatestPreview({ fetcher, draft: { n }, enabled, delay: 0 }), { initialProps: { n: 1 } });
  const release = async () => { await act(async () => { releases.splice(0).forEach((go) => go()); }); };
  return { outcome, fetcher, view, release, state: () => view.result.current };
};
const HOOK_ROWS = {
  'another draft that cannot be asked shows no answer; `last` keeps it': async (h) => {
    h.view.rerender({ n: 3, enabled: false });
    expect(h.state()).toMatchObject({ data: null, last: { n: 1 }, pending: false, failed: false, fresh: false });
  },
  'the answered draft itself, disabled, still shows its own answer': async (h) => {
    h.view.rerender({ n: 1, enabled: false });
    expect(h.state()).toMatchObject({ data: { n: 1 }, pending: false, failed: false });
  },
  'after a failure, another draft that cannot be asked shows no answer (not the one before the failure)': async (h) => {
    h.outcome.fail = true;
    h.view.rerender({ n: 2 });
    await waitFor(() => expect(h.state().failed).toBe(true));
    h.outcome.fail = false;
    h.view.rerender({ n: 4, enabled: false });
    expect(h.state()).toMatchObject({ data: null, last: { n: 1 }, failed: false, error: null, pending: false });
  },
  'an edited draft still asked keeps the latest answer, pending, until its own (never « — » for a frame)': async (h) => {
    h.view.rerender({ n: 2 });
    expect(h.state()).toMatchObject({ data: { n: 1 }, pending: true, fresh: false });
    await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
    await h.release();
    expect(h.state()).toMatchObject({ data: { n: 2 }, fresh: true });
  },
  'enabled again, the draft is asked and its answer shown': async (h) => {
    h.view.rerender({ n: 3, enabled: false });
    h.view.rerender({ n: 3, enabled: true });
    await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
    await h.release();
    expect(h.state()).toMatchObject({ data: { n: 3 }, fresh: true });
  },
};

test.each(Object.keys(HOOK_ROWS))('the hook: %s', async (name) => {
  const h = harness();
  await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(1));
  await h.release();
  expect(h.state()).toMatchObject({ data: { n: 1 }, fresh: true });
  await HOOK_ROWS[name](h);
});

// --- the screens -----------------------------------------------------------------------------------------------------------------------

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
const FIGURES = (commission) => ({ valid: true, needsChoice: false, warnings: [], errors: [], before: { payout: 570.02, commission: 229.98, netReceived: 570.02 }, after: { payout: 610.02, commission, netReceived: 570.02 } });
const PROPOSAL = {
  id: 'p:7|balance,8|balance', bank: { transactionId: 'p', amountCents: 70000, dateLabel: '15/10' },
  pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41800 }, { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25100 }],
};
const anyText = (pattern) => pattern.test(document.body.textContent);
const counterAddOne = () => fireEvent.click(screen.getByRole('button', { name: /Bière locale/ }));
const typeEmail = (value) => fireEvent.change(screen.getByLabelText('E-mail'), { target: { value } });
const counterUnknown = () => {
  expect(screen.getByTestId('sale-total')).toHaveTextContent('—');
  // The catalogue's own unit price (« 6,50 € » on the article) is not a figure of the answer; the line's detail and the totals are.
  expect(anyText(/× 6,50|13,00|19,50/)).toBe(false);
  expect(document.querySelectorAll('[data-tender-amount]')).toHaveLength(0);
  expect(screen.getByRole('button', { name: /^Enregistrer la vente/ })).toBeDisabled();
};

// Each member: `answer(state)` reaches an accepted answer whose figures match `stale`; `disable(state)` turns the draft into one that cannot be
// asked while it stays on screen; `check()` its placeholders. `failFirst` runs the same after a failed request (the alert is gone once the
// draft cannot be asked, loop t24 S24-2, and the answer from before the failure must not come back).
const MEMBERS = {
  StandaloneSaleDialog: {
    async answer(state) {
      api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: BEER });
      api.quoteStandaloneSale.mockImplementation(async (body) => { if (state.fail) throw offline(); return counterQuote(body.lines); });
      render(<StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />);
      await screen.findByRole('button', { name: /Bière locale/ });
      counterAddOne();
      await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('6,50'));
    },
    async fail(state) { state.fail = true; counterAddOne(); await screen.findByText('Service indisponible'); state.fail = false; },
    async disable() { typeEmail('client'); counterAddOne(); counterAddOne(); await pause(300); },
    check: counterUnknown,
    async enable() { typeEmail('client@example.test'); await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent(/\d,\d\d/)); },
  },
  PlatformPenaltyDialog: {
    async answer(state) {
      api.previewPlatformPenalty.mockImplementation(async (id, body) => {
        if (state.fail) throw offline();
        return FIGURES(Math.round((229.98 - body.amount) * 100) / 100);
      });
      render(<DialogProvider><PlatformPenaltyDialog open onClose={() => {}} reservationId={7} source="fiche" onDone={() => {}} initialAmount={40} /></DialogProvider>);
      await screen.findByText(/Commission 229,98 € → 189,98 €/);
    },
    async fail(state) {
      state.fail = true;
      fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: '25' } });
      await screen.findByText('Service indisponible');
      state.fail = false;
    },
    disables: ['', '0', '30x'],
    async disable(state, value) { fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value } }); await pause(400); },
    check() {
      expect(anyText(/Commission 229,98|Versement attendu/)).toBe(false);
      expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    },
    async enable() { fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: '10' } }); await screen.findByText(/Commission 229,98 € → 219,98 €/); },
  },
  SplitSharesDialog: {
    async answer(state) {
      api.previewReconciliationAllocation.mockImplementation(async (body) => {
        if (state.fail) throw offline();
        const sum = body.pairs.reduce((total, p) => total + p.amountCents, 0);
        return previewPayload({ valid: false, errors: [{ code: 'SHARES_DO_NOT_SUM', field: 'shares', message: `Il manque ${((70000 - sum) / 100).toFixed(2).replace('.', ',')} € : les parts doivent faire 700,00 €.` }] });
      });
      render(<SplitSharesDialog open onClose={() => {}} onSubmit={() => {}} proposal={PROPOSAL} labels={{ '7|balance': 'Séjour 7', '8|balance': 'Séjour 8' }} />);
      await screen.findByText(/Il manque 31,00 €/);
    },
    async fail(state) {
      state.fail = true;
      fireEvent.change(screen.getByLabelText('Séjour 8 (€)'), { target: { value: '252,00' } });
      await screen.findByText('Service indisponible');
      state.fail = false;
    },
    async disable() { fireEvent.change(screen.getByLabelText('Séjour 8 (€)'), { target: { value: '25x' } }); await pause(300); },
    check() {
      expect(anyText(/Il manque/)).toBe(false);
      expect(screen.getByRole('button', { name: 'Répartir et confirmer' })).toBeDisabled();
    },
    async enable() { fireEvent.change(screen.getByLabelText('Séjour 8 (€)'), { target: { value: '282,00' } }); await screen.findByText(/Il manque 0,00 €/); },
  },
  LinkTransactionDialog: {
    async answer(state) {
      api.getReconciliationFicheCredits.mockResolvedValue(ficheCreditsPayload());
      api.previewReconciliationAllocation.mockImplementation(async (body) => {
        if (state.fail) throw offline();
        const cents = body.pairs ? body.pairs[0].amountCents : 30000;
        return previewPayload({ summaryLabel: `1 virement · ${(cents / 100).toFixed(2).replace('.', ',')} €` });
      });
      render(<LinkTransactionDialog open onClose={() => {}} onSubmit={() => {}} reservationId={7} />);
      fireEvent.click((await screen.findAllByRole('checkbox'))[0]);
      await screen.findByText('1 virement · 300,00 €');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier la répartition' }));
      await screen.findByLabelText(/→ Acompte \(€\)/);
    },
    async fail(state) {
      state.fail = true;
      fireEvent.change(screen.getByLabelText(/→ Acompte \(€\)/), { target: { value: '120,50' } });
      await screen.findByText(/Service indisponible/);
      state.fail = false;
    },
    async disable() { fireEvent.change(screen.getByLabelText(/→ Acompte \(€\)/), { target: { value: '12,345' } }); await pause(300); },
    check() {
      expect(anyText(/1 virement · /)).toBe(false);
      // The split field keeps its name (a receipt's label is not a figure of the split).
      expect(screen.getByLabelText(/→ Acompte \(€\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rattacher' })).toBeDisabled();
    },
    async enable() { fireEvent.change(screen.getByLabelText(/→ Acompte \(€\)/), { target: { value: '150,00' } }); await screen.findByText('1 virement · 150,00 €'); },
  },
};
// Screens whose draft does not stay on screen once it cannot be asked: nothing older can be drawn as its answer.
const NOT_MEMBERS = {
  ResourceArrivalDialog: 'an undirtied draft is null and the stored visit is drawn; the invoice question reads only a fresh answer (pending block otherwise)',
  ResourceBookingDialog: 'the price is drawn only for a draft (`shownPrice = draft ? … : null`); the invoice question as in the arrival',
  ReservationSasDialog: 'a page without money disables the recap; the money pages draw `last` with « — » while failed',
};

test('every screen that previews through the hook, read from the code, is a member with its row or says why not', () => {
  expect(CONSUMERS).toEqual([...Object.keys(MEMBERS), ...Object.keys(NOT_MEMBERS)].sort());
});

const CASES = Object.entries(MEMBERS).flatMap(([name, row]) => (row.disables || [null]).flatMap((value) => [
  [name, value, false], [name, value, true],
]));
test.each(CASES)('%s — a draft that cannot be asked (%s), failure first: %s — shows no older answer, then the new one once asked', async (name, value, failFirst) => {
  const row = MEMBERS[name];
  const state = {};
  await row.answer(state);
  if (failFirst) await row.fail(state);
  await row.disable(state, value);
  row.check();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  await row.enable(state);
});
