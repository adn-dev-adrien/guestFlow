// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: the SAS recaps
// (`ReservationSasDialog`, arrival and departure: the recap preview, « Plusieurs moyens », the steps back and forth, the commit). The driver
// and the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../api';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../theme';
import DialogProvider from '../components/DialogProvider';
import ReservationSasDialog from '../plugins/sas/ReservationSasDialog';
import { sasPayload, stayDue } from '../plugins/sas/__tests__/sasFixtures';
import { recapFor, departureRecapFor } from '../plugins/sas/__tests__/sasPreviewFake';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, findButton, findButtons, retryOp, tenderBlocks, tendersOnScreen, tenderSig,
  flush, advance, realWait, centsOfInput,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());
vi.mock('../hooks/usePlugins', () => ({ usePlugin: () => true }));

// The stays of the « Plusieurs moyens » suites: an arrival with two offerable lines and the stay due, a departure with linen and cleaning.
const LINE = (optionId, title, price) => ({ optionId, title, inComplement: 1, offered: 0, totalPrice: price, originalTotalPrice: price, unitPrice: price, billedUnits: 1, quantity: 1 });
const ARRIVAL_STAY = sasPayload({
  reservation: { cautionAmount: 0, complementAmount: 30.37, options: [LINE(5, 'Panier gourmand', 20.13), LINE(6, 'Vin local', 10.24)] },
  cleaning: { included: true, price: 80 },
  stayPayment: stayDue(),
});
const LINEN_STAY = sasPayload({
  reservation: {
    cautionAmount: 0,
    endOfStayComplementDetail: JSON.stringify([{ label: 'Linge de toilette', qty: 3, unitPrice: 8.07, amount: 24.21, source: 'arrivalBathLinen' }]),
  },
  cleaning: { included: false, price: 80 },
});
const offerSig = (answer) => answer.lines.filter((l) => l.offerable && l.key).map((l) => (l.offered ? 'O' : 'F')).join('');
const offerButtons = (ctx) => findButtons(ctx, /^(Offrir|✓ Offert|Offert)$/);
const screenOffers = (ctx) => offerButtons(ctx).map((b) => (/Offert/.test(b.textContent) ? 'O' : 'F')).join('');
const onRecap = () => /Récapitulatif — |Récapitulatif fin de séjour/.test(document.body.textContent);
const commitButton = (ctx) => findButton(ctx, /^(Valider et terminer|Encaisser|Calcul du total…)/);
const ERRORS = [/Total indisponible/, /Le récapitulatif est refusé/];

// Every request the setup meets is answered at once: the walk to the recap is not under test.
async function settleAll(ctx) {
  for (let i = 0; i < 6; i += 1) {
    const pending = ctx.server.pending();
    if (!pending.length) break;
    for (const req of pending) await act(async () => { ctx.server.settle(req, 'ok'); });
    await advance(ctx, 50);
  }
}
async function step(ctx) { await settleAll(ctx); await advance(ctx, 250); await settleAll(ctx); }
async function clickNamed(ctx, name) {
  for (let i = 0; i < 20; i += 1) {
    const b = findButton(ctx, name);
    if (b && !b.disabled) { await press(ctx, b); await step(ctx); return true; }
    await step(ctx);
    await realWait(5);
  }
  return false;
}
async function walkArrival(ctx) {
  await clickNamed(ctx, 'Commencer');
  for (let i = 0; i < 14 && !onRecap(); i += 1) {
    if (/Séjour à régler :/.test(document.body.textContent)) await step(ctx);
    await clickNamed(ctx, 'Suivant');
  }
  ctx.focusedOnce = false;
  ctx.typed.clear();
}
async function walkDeparture(ctx) {
  await clickNamed(ctx, 'Commencer');
  await clickNamed(ctx, 'Pas OK');
  for (let i = 0; i < 3; i += 1) await clickNamed(ctx, 'Oui');
  ctx.focusedOnce = false;
}

function sasFamily(end) {
  const payload = end === 'arrival' ? ARRIVAL_STAY : LINEN_STAY;
  const recapOf = end === 'arrival' ? (draft) => recapFor(payload, draft) : (draft) => departureRecapFor(payload, draft);
  // The key is the request as the dialog sends it: the arrival lists its offers in the order they were chosen (the hook tells drafts apart
  // by their exact content); the departure's stored lines keep their own order.
  const LINE_KEYS = recapOf({}).lines.filter((l) => l.offerable && l.key).map((l) => l.key);
  const draftKeyOf = (draft) => (end === 'arrival'
    ? (draft.offered || []).filter((x) => x.kind !== 'upsell').map((x) => `${x.kind}:${x.id}`).join(',')
    : offerSig(recapOf(draft)));
  const screenKeyOf = (ctx) => (end === 'arrival'
    ? ctx.state.order.map((i) => LINE_KEYS[i]).join(',')
    : ctx.state.offers.join(''));
  const dueOf = (answer) => Math.round(Number(end === 'arrival' ? answer.totalAtArrival : answer.grandTotal) * 100);
  const route = end === 'arrival' ? 'previewArrivalSas' : 'previewDepartureSas';
  const commitRoute = end === 'arrival' ? 'commitArrivalSas' : 'commitDepartureSas';
  const ready = () => /Commencer/.test(document.body.textContent);
  const adapter = {
    name: `ReservationSasDialog ${end}`,
    fixtures: payload,
    staticCents: [807, 2421],
    routes: () => ({
      getReservationSas: { kind: 'read', answer: () => payload },
      getReservationWeatherAlerts: { kind: 'read', answer: () => ({ configured: false, resolved: false, department: null, alerts: [] }) },
      [route]: { kind: 'preview', channel: 'recap', key: (_id, draft) => draftKeyOf(draft), answer: (_id, draft) => recapOf(draft) },
      [commitRoute]: { kind: 'commit', answer: () => ({ ok: true }) },
    }),
    // The tree of the SAS suites' `renderDialog`, rendered by the harness (its React-commit probe wraps it).
    render: (ctx) => (
      <MemoryRouter>
        <ThemeProvider theme={theme}><DialogProvider>
          <ReservationSasDialog open reservationId={1} mode={end} onClose={() => { ctx.closed = true; }} onDone={() => { ctx.done = true; }} />
        </DialogProvider></ThemeProvider>
      </MemoryRouter>
    ),
    ready,
    setup: async (ctx) => {
      if (end === 'arrival') await walkArrival(ctx); else await walkDeparture(ctx);
      if (!onRecap()) throw new Error('the walk to the recap did not reach it');
      // The operator's « Offrir » choices: what the draft asks, whatever the answer says meanwhile.
      ctx.state.offers = screenOffers(ctx).split('');
      ctx.state.order = [];
    },
    channels: [{ name: 'recap', key: (ctx) => (onRecap() && ctx.state.offers ? screenKeyOf(ctx) : null), failureWords: (req) => [req.message, ...ERRORS], retry: true }],
    // I3 — an « Offrir » toggle is the operator's input: it shows what was chosen through answers, failures and retries.
    extraChecks: (ctx, v) => {
      if (!onRecap() || !ctx.state.offers) return;
      const shown = screenOffers(ctx);
      if (shown && shown !== ctx.state.offers.join('')) v.push({ code: 'I3', message: `« Offrir » chosen ${ctx.state.offers.join('')} now reads ${shown}` });
    },
    commitButton: (ctx) => (onRecap() ? commitButton(ctx) : null),
    dueOf: (ctx) => {
      const state = ctx.states.recap;
      const dues = [];
      if (state.kind === 'fresh') dues.push(dueOf(state.req.answer));
      if (state.kind === 'pending' && ctx.server.accepted.recap) dues.push(dueOf(ctx.server.accepted.recap.answer));
      return dues;
    },
    nominal: (ctx) => {
      const state = ctx.states.recap;
      return { known: state.kind === 'fresh' && dueOf(state.req.answer) > 0, elements: [commitButton(ctx)] };
    },
    liveness: (ctx, blocks) => {
      const state = ctx.states.recap;
      const button = commitButton(ctx);
      if (!button || !button.disabled || state.kind !== 'fresh') return null;
      const b = blocks[0];
      if (b && (!(b.covered || (b.short && b.shortfall)) || b.lines.some((l) => !(centsOfInput(l.value) > 0) && !(l.auto && b.lines.length > 1)))) return null;
      return `« ${button.textContent.trim()} » disabled on a fresh recap with every question answered`;
    },
    snapshot: (ctx) => {
      const block = tenderBlocks(document.body)[0];
      return { key: screenKeyOf(ctx), payment: block ? tenderSig(tendersOnScreen(block), block.short ? block.shortfall : null) : null };
    },
    commitCheck: (ctx, req, snap) => {
      const out = [];
      const body = req.args[1] || {};
      const sent = draftKeyOf(body);
      if (snap && sent !== snap.key) out.push(`the ${end} sent offers ${sent} for ${snap.key} on screen`);
      const tenders = body.tenders || (body.payment && body.payment.tenders) || (body.split && body.split.tenders);
      if (snap && snap.payment && tenders) {
        const shortfall = body.shortfall || (body.payment && body.payment.shortfall) || (body.split && body.split.shortfall);
        const sentPay = tenderSig(tenders, shortfall && shortfall.kind);
        if (sentPay !== snap.payment) out.push(`the ${end} sent the payment ${sentPay} for ${snap.payment} on screen`);
      }
      return out;
    },
    ops: {
      offer: {
        weight: 4,
        applicable: (ctx) => offerButtons(ctx).some((b) => !b.disabled),
        gen: (rnd) => ({ at: rnd.int(3) }),
        async run(ctx, { at }) {
          const list = offerButtons(ctx);
          const i = at % list.length;
          if (!list[i] || list[i].disabled) return false;
          // The model moves with the click, before React commits it: the probe judges every commit against the draft clicked.
          const before = { offers: [...ctx.state.offers], order: ctx.state.order };
          const ok = await press(ctx, list[i], () => {
            ctx.state.offers[i] = ctx.state.offers[i] === 'O' ? 'F' : 'O';
            ctx.state.order = ctx.state.offers[i] === 'O' ? [...ctx.state.order, i] : ctx.state.order.filter((x) => x !== i);
          });
          if (!ok) { ctx.state.offers = before.offers; ctx.state.order = before.order; }
          return ok;
        },
      },
      split: {
        weight: 2,
        applicable: () => Boolean(document.querySelector(`[data-split-toggle="${end}"]:not([disabled])`)),
        async run(ctx) {
          ctx.tenderSnap = null;
          ctx.shortSnap = null;
          return press(ctx, document.querySelector(`[data-split-toggle="${end}"]`));
        },
      },
      payMode: {
        weight: 1,
        applicable: (ctx) => Boolean(findButton(ctx, 'Payé en liquide')),
        gen: (rnd) => ({ label: rnd.pick(['CB / Chèque', 'Payé en liquide', 'Plus tard']) }),
        run: (ctx, { label }) => press(ctx, findButton(ctx, label)),
      },
      back: {
        weight: 1,
        applicable: (ctx) => onRecap() && Boolean(findButton(ctx, 'Précédent')),
        async run(ctx) {
          const ok = await press(ctx, findButton(ctx, 'Précédent'));
          await flush();
          ctx.track();
          // The operator comes back to the recap: a step back and forth is one gesture here.
          for (let i = 0; i < 3 && !onRecap(); i += 1) {
            const next = findButton(ctx, 'Suivant');
            if (!next || next.disabled) break;
            // eslint-disable-next-line no-await-in-loop
            await press(ctx, next);
            // eslint-disable-next-line no-await-in-loop
            await flush();
          }
          return ok;
        },
      },
      retry: retryOp,
      commit: { weight: 2, commit: true, applicable: (ctx) => Boolean(commitButton(ctx)), run: (ctx) => press(ctx, commitButton(ctx)) },
    },
  };
  return adapter;
}

test('the SAS arrival recap keeps the money-dialog invariants on every generated seed', async () => {
  // Seeds found by the long runs (loop t26): steps back and forth around the recap, « Offrir » undone at once.
  const failures = await runFamily(sasFamily('arrival'), api, { seeds: harnessSeeds([1, [85, 60], [88, 60], [95, 60], [202, 60], [208, 60], [210, 60], [211, 60], [224, 60], [227, 60], [229, 60], [235, 60], [257, 60], [298, 60], [306, 60], [307, 60], [332, 60], [334, 60], [335, 60]]), steps: harnessSteps(25) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(180000));

test('the SAS departure recap keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(sasFamily('departure'), api, { seeds: harnessSeeds([1, 2, 3]), steps: harnessSteps(25) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(120000));
