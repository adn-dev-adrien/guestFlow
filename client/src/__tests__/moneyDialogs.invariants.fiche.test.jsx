// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: the fiche's own payment forms
// (`FinanceSection` « Encaisser en une fois » and the ledger rows' `PaymentMarkForm` with « Plusieurs moyens »). Their due is the fiche's
// read, not a preview: the gesture « the fiche is read again » moves it. The driver and the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../api';
import DialogProvider from '../components/DialogProvider';
import FinanceSection from '../components/reservation/FinanceSection';
import { ReservationFormProvider } from '../components/reservation/ReservationFormContext';
import { makeMockContext } from '../components/reservation/__tests__/mockReservationForm';
import { dueRow, ledgerOf } from '../components/reservation/__tests__/ledgerFixtures';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, findButton, findButtons, tenderBlocks, tendersOnScreen,
  tenderSig, centsOfInput,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());

const DUES = [85282, 91307, 12345];
const METHODS = [{ value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'cheque', label: 'Chèque' }, { value: 'transfer', label: 'Virement' }];
const valueOf = (ctx) => {
  const due = DUES[(ctx.state.read || 0) % DUES.length];
  const balance = due - 13200;
  return makeMockContext({
    editingReservationId: 7,
    reservationId: 7,
    form: {
      arrivalPayment: {
        collectible: {
          total: due / 100,
          buckets: [{ bucket: 'balance', label: 'solde', amount: balance / 100 }, { bucket: 'complement', label: 'complément', amount: 132 }],
          // date-literal-ok: the booking day of the fixture's collectible, drawn by nothing the harness compares with today
          bookedAt: '2026-08-01',
        },
      },
    },
    ledger: ledgerOf([
      dueRow('balance', 'Solde', balance / 100, { action: { kind: 'mark', label: 'Marquer perçu', split: { dueCents: balance, methods: METHODS } } }),
      dueRow('complement', 'Complément d\'arrivée', 132, { action: { kind: 'mark', label: 'Marquer perçu', split: { dueCents: 13200, methods: METHODS } } }),
    ]),
    reloadReservationFinance: () => Promise.resolve(),
  });
};
const tree = (ctx) => (
  <DialogProvider>
    <ReservationFormProvider value={valueOf(ctx)}>
      <FinanceSection />
    </ReservationFormProvider>
  </DialogProvider>
);
const scope = () => [document.body];
const collectButtons = (ctx) => findButtons(ctx, /^Encaisser \d/);
const dues = (ctx) => {
  const due = DUES[(ctx.state.read || 0) % DUES.length];
  return [due, due - 13200, 13200];
};

const adapter = {
  name: 'FinanceSection',
  // The fiche's own figures (its read, every version of it): what it draws besides the lines.
  fixtures: DUES.map((_, read) => { const { form, ledger } = valueOf({ state: { read } }); return { form, ledger }; }),
  scope,
  routes: () => ({
    settleArrivalPayment: { kind: 'commit', answer: () => ({}) },
    markPayment: { kind: 'commit', answer: () => ({ ok: true }) },
    splitMarkPayment: { kind: 'commit', answer: () => ({ ok: true }) },
  }),
  render: tree,
  ready: () => /Encaisser en une fois/.test(document.body.textContent),
  setup: (ctx) => { ctx.state.read = 0; },
  onRemount: (ctx) => { ctx.state.read = 0; },
  channels: [],
  commitButton: collectButtons,
  dueOf: (ctx) => dues(ctx),
  liveness: (ctx, blocks) => {
    const late = collectButtons(ctx).filter((b) => b.disabled);
    if (!late.length || blocks.length !== 1) return null;
    const b = blocks[0];
    if (!(b.covered || (b.short && b.shortfall && !b.whole)) || b.lines.some((l) => !(centsOfInput(l.value) > 0) && !(l.auto && b.lines.length > 1))) return null;
    return `« ${late[0].textContent.trim()} » disabled with lines covering the due`;
  },
  snapshot: () => {
    const block = tenderBlocks(document.body)[0];
    return { payment: block ? tenderSig(tendersOnScreen(block), block.short ? block.shortfall : null) : null, due: block ? block.dueCents : null };
  },
  commitCheck: (_ctx, req, snap) => {
    const body = req.args.find((a) => a && a.tenders) || null;
    if (!body || !snap || !snap.payment) return [];
    const sent = tenderSig(body.tenders, body.shortfall && body.shortfall.kind);
    const out = sent !== snap.payment ? [`${req.name} sent ${sent} for ${snap.payment} on screen`] : [];
    if (body.expectedAmountCents != null && body.expectedAmountCents !== snap.due) out.push(`${req.name} expected ${body.expectedAmountCents} for a due of ${snap.due} on screen`);
    return out;
  },
  ops: {
    split: {
      weight: 2,
      gen: (rnd) => ({ at: rnd.int(3) }),
      async run(ctx, { at }) {
        const toggles = [...document.querySelectorAll('[data-split-toggle]')];
        if (!toggles.length) return false;
        ctx.tenderSnap = null; ctx.shortSnap = null;
        return press(ctx, toggles[at % toggles.length]);
      },
    },
    markRow: {
      weight: 1,
      applicable: (ctx) => findButtons(ctx, 'Marquer perçu').length > 0,
      gen: (rnd) => ({ at: rnd.int(2) }),
      run: (ctx, { at }) => { const list = findButtons(ctx, 'Marquer perçu'); return press(ctx, list[at % list.length]); },
    },
    reread: {
      weight: 1,
      async run(ctx) {
        ctx.state.read += 1;
        await act(async () => { ctx.view.rerender(tree(ctx)); });
        return true;
      },
    },
    commit: { weight: 2, commit: true, applicable: (ctx) => collectButtons(ctx).length > 0, gen: (rnd) => ({ at: rnd.int(2) }), run: (ctx, { at }) => { const list = collectButtons(ctx); return press(ctx, list[at % list.length]); } },
  },
  afterCommitOk: async (ctx) => { ctx.done = true; },
};

test('the fiche\'s payment forms keep the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, 2, 3, [461, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout());
