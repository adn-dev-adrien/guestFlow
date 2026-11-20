// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: the arrival of an outside visit
// (`ResourceArrivalDialog`, the mini SAS: its draft quote, the invoice question of the payment typed, the commit). The driver and the
// invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { vi } from 'vitest';
import api from '../api';
import ResourceArrivalDialog from '../plugins/hourly-resources/ResourceArrivalDialog';
import { visitPayload, SUGGESTIONS } from '../plugins/hourly-resources/__tests__/arrivalVisitFixtures';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, typeInto, findButton, actionButton, retryOp, remountOp, tenderBlocks,
  articleRows, tendersOnScreen, tenderSig,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());
vi.mock('../hooks/usePlugins', () => ({ usePlugin: () => true, usePlugins: () => ({ plugins: [] }) }));

const TITLE = 'Proposés à l’arrivée';
const BASE = visitPayload();
const draftKeyOf = (body) => JSON.stringify([body.offeredMinutes || 0, Boolean(body.sessionOffered), (body.extras || []).map((e) => `${e.articleRef}x${e.quantity}${e.offered ? 'o' : ''}`)]);
const paymentSig = (payment) => tenderSig(payment.tenders, payment.shortfall && payment.shortfall.kind);
const requestKey = (body) => (body.payment ? `${draftKeyOf(body)}|${paymentSig(body.payment)}` : draftKeyOf(body));
// The server's quote, as the suites' stand-in prices it (`fakeQuote`), answered synchronously: the session less its offered time, the
// extras at the catalogue price within their bounds, and with a payment typed the invoice question for it.
const CATALOGUE = { 'option:7': { label: 'Bière locale', unitCents: 650, max: 12 }, 'option:8': { label: 'Limonade', unitCents: 400, max: 12 } };
function answerOf(body) {
  const minutes = body.offeredMinutes || 0;
  const sessionTotal = body.sessionOffered ? 0 : 12000 - Math.round((minutes / 60) * 5000);
  const lines = BASE.lines.map((line) => (line.kind === 'session' && line.draft ? {
    ...line, totalCents: sessionTotal, offered: Boolean(body.sessionOffered),
    components: minutes ? [...line.components, { key: 'offered', label: 'Temps offert', detail: `${minutes} min`, amountCents: -(12000 - sessionTotal) }] : line.components,
  } : line));
  const refusals = [];
  (body.extras || []).forEach((extra, index) => {
    const article = CATALOGUE[extra.articleRef];
    if (!(extra.quantity >= 1 && extra.quantity <= article.max)) { refusals.push({ field: extra.articleRef, code: 'QUANTITY_OUT_OF_BOUNDS', error: `Quantité : 1 à ${article.max}.` }); return; }
    const catalogueCents = extra.quantity * article.unitCents;
    lines.push({
      id: null, ref: `draft:${index + 1}`, kind: 'extra', label: article.label, detail: `${extra.quantity} × ${(article.unitCents / 100).toFixed(2).replace('.', ',')} €`, components: [],
      quantity: extra.quantity, unitCents: article.unitCents, totalCents: extra.offered ? 0 : catalogueCents, catalogueCents, offered: Boolean(extra.offered),
      status: extra.offered ? 'offered' : 'due', statusLabel: extra.offered ? 'Offerte' : 'À payer', settledCents: 0, vatRate: 20, legacy: false, draft: true,
    });
  });
  const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const out = { ...BASE, lines, totals: { ...BASE.totals, totalCents, remainingCents: totalCents }, vatByRate: [{ rate: 20, vatCents: Math.round((totalCents * 20) / 120) }], quoted: true, refusals };
  if (body.payment) {
    const tenders = body.payment.tenders || [];
    const paid = tenders.reduce((sum, t) => sum + t.amountCents, 0);
    out.invoiceable = tenders.some((t) => t.internal) ? { ok: false, code: 'INTERNAL_CASH', reason: 'Caisse interne : hors comptabilité.' }
      : (paid === totalCents ? { ok: true, code: null, reason: null } : { ok: false, code: 'REMAINING_DUE', reason: 'Reste à payer : facture après le solde.' });
  }
  return out;
}

// The last number each quantity field showed (a row keeps its field until removed).
let qtyCache = new WeakMap();
function screenDraft() {
  const minutes = Number((document.querySelector('[role="group"][aria-label="Temps offert"] p') || {}).textContent || 0);
  const session = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')].find((b) => !b.closest('li') && /^Offer?t?/.test(b.textContent));
  const sessionOffered = Boolean(session && session.getAttribute('aria-pressed') === 'true');
  const extras = articleRows(TITLE).map((row) => {
    const name = row.querySelector('p').textContent;
    const article = SUGGESTIONS.find((a) => a.label === name);
    const input = row.querySelector('input');
    const offered = row.querySelector('button[aria-pressed="true"]') ? 'o' : '';
    let quantity = /^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : qtyCache.get(input);
    if (quantity != null) qtyCache.set(input, quantity);
    if (quantity == null) quantity = 1;
    return `${article ? article.articleRef : name}x${quantity}${offered}`;
  });
  if (minutes === 0 && !sessionOffered && extras.length === 0) return null;
  return JSON.stringify([minutes, sessionOffered, extras]);
}
const collecting = () => Boolean([...document.querySelectorAll('[role="dialog"] button[aria-pressed="true"]')].find((b) => b.textContent === 'Encaisser'));
function screenPayment() {
  if (!collecting()) return null;
  const block = tenderBlocks(document.body)[0];
  if (!block) return null;
  return tenderSig(tendersOnScreen(block), block.short ? block.shortfall : null);
}
const validateButton = () => actionButton(/^(Valider l’arrivée|Enregistrer|Créer la facture|Enregistrement…)$/);
const invoiceBox = () => document.querySelector('[data-testid="invoice-block"] input[type="checkbox"]');
const ready = () => Boolean(document.querySelector('[data-testid="remaining"]'));
const dueOfAnswer = (answer) => answer.totals.remainingCents;

const adapter = {
  name: 'ResourceArrivalDialog',
  fixtures: [BASE, { offered: [1250, 2500, 3750, 5000, 6250, 7500, 8750, 10000, 11250, 12000] }],
  routes: () => ({
    getResourceVisit: { kind: 'read', answer: () => BASE },
    searchResourceVisitArticles: { kind: 'read', answer: () => ({ groups: [] }) },
    quoteResourceVisit: {
      kind: 'preview',
      channel: (_id, body) => (body.payment ? 'invoice' : 'draft'),
      key: (_id, body) => requestKey(body),
      answer: (_id, body) => answerOf(body),
      silent: (_id, body) => ({ ...answerOf(body), ...(body.payment ? { invoiceable: { ok: false, code: 'NOTHING', reason: null, silent: true } } : {}) }),
    },
    commitResourceVisit: { kind: 'commit', answer: () => ({ visit: BASE, invoice: { ok: true } }) },
  }),
  render: (ctx) => <ResourceArrivalDialog open bookingId={5} onClose={() => { ctx.closed = true; }} onDone={() => { ctx.done = true; }} />,
  ready,
  setup: () => { qtyCache = new WeakMap(); },
  onRemount: () => { qtyCache = new WeakMap(); },
  channels: [
    { name: 'draft', key: screenDraft, failureWords: (req) => [req.message, /Total indisponible|Montant indisponible/] },
    {
      name: 'invoice',
      // The question is asked for the payment typed against the due of the draft on screen, once that draft is answered.
      key: (ctx) => {
        const pay = screenPayment();
        if (!pay) return null;
        // Asked once the draft on screen is answered (or there is none): before that the question waits, pending.
        const draft = ctx.channelState(adapter.channels[0], screenDraft());
        if (!['idle', 'fresh'].includes(draft.kind)) return null;
        return `${screenDraft() || draftKeyOf({})}|${pay}`;
      },
      idleCommits: true,
      figures: true,
      failureWords: (req) => [req.message, 'Facture non vérifiée pour ce paiement.'],
    },
  ],
  commitButton: validateButton,
  requirements: (ctx) => {
    const draft = ctx.states.draft;
    const out = [];
    if (draft.kind === 'fresh' && draft.req.answer.refusals.length) out.push('the draft has refusals');
    return out;
  },
  dueOf: (ctx) => {
    const state = ctx.states.draft;
    const dues = [];
    if (state.kind === 'idle') dues.push(dueOfAnswer(BASE));
    if (state.kind === 'fresh') dues.push(dueOfAnswer(state.req.answer));
    if (state.kind === 'pending') dues.push(ctx.server.accepted.draft ? dueOfAnswer(ctx.server.accepted.draft.answer) : dueOfAnswer(BASE));
    return dues;
  },
  nominal: (ctx) => {
    const state = ctx.states.draft;
    return { known: state.kind === 'fresh' && !state.req.answer.refusals.length, elements: [document.querySelector('[data-testid="remaining"]')] };
  },
  findTyped: (_ctx, ident) => {
    if (ident.startsWith('qty:')) { const row = articleRows(TITLE)[Number(ident.split(':')[1])]; return row ? [row.querySelector('input')] : []; }
    return [];
  },
  findTick: () => invoiceBox(),
  // « Créer la facture dans Qonto » follows the card: when a gesture on the lines adds or takes away the presence of a card line, the
  // dialog ticks the box for a card and unticks it otherwise (`setInvoiceChecked(hasCard(next))`); any other gesture leaves it.
  onTenderGesture: (ctx, before, after) => {
    const card = (lines) => Boolean(lines && lines.some((l) => l.method === 'card'));
    if (ctx.tickSnap.has('invoice') && card(before) !== card(after)) ctx.tickSnap.set('invoice', card(after));
  },
  snapshot: () => {
    const block = tenderBlocks(document.body)[0];
    return { draft: screenDraft(), payment: screenPayment(), tick: invoiceBox() ? invoiceBox().checked : null, offered: Boolean(block) };
  },
  commitCheck: (ctx, req, snap) => {
    const out = [];
    const [, body] = req.args;
    const sentDraft = body.extras ? draftKeyOf(body) : null;
    if ((snap.draft || null) !== (body.extras || body.offeredMinutes != null ? sentDraft : null) && !(snap.draft == null && sentDraft === draftKeyOf({}))) out.push(`the arrival sent the draft ${sentDraft} for ${snap.draft} on screen`);
    const sentPay = body.payment ? paymentSig(body.payment) : null;
    if (sentPay !== snap.payment) out.push(`the arrival sent the payment ${sentPay} for ${snap.payment} on screen`);
    if (snap.tick != null && Boolean(body.invoice) && !snap.tick) out.push('the arrival asked an invoice the box did not tick');
    return out;
  },
  ops: {
    addArticle: {
      weight: 3,
      gen: (rnd) => ({ label: rnd.pick(['Bière locale', 'Limonade']) }),
      async run(ctx, { label }) {
        const chip = [...document.querySelectorAll('[role="dialog"] [role="button"]')].find((b) => b.textContent.startsWith(label) && b.classList.contains('MuiChip-root'));
        [...ctx.typed.keys()].filter((k) => k.startsWith('qty:')).forEach((k) => ctx.typed.delete(k));
        return press(ctx, chip);
      },
    },
    offeredTime: {
      weight: 2,
      gen: (rnd) => ({ more: rnd.next() < 0.6 }),
      run: (ctx, { more }) => press(ctx, findButton(ctx, more ? 'Plus 15 minutes' : 'Moins 15 minutes')),
    },
    offerSession: {
      weight: 1,
      run: (ctx) => press(ctx, [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')].find((b) => !b.closest('li') && /^Offer?t?/.test(b.textContent))),
    },
    stepper: {
      weight: 2,
      applicable: () => articleRows(TITLE).length > 0,
      gen: (rnd) => ({ row: rnd.int(3), more: rnd.next() < 0.6 }),
      async run(ctx, { row, more }) {
        const list = articleRows(TITLE);
        const target = list[row % list.length];
        ctx.typed.delete(`qty:${row % list.length}`);
        return press(ctx, [...target.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === (more ? 'Un de plus' : 'Un de moins')));
      },
    },
    typeQuantity: {
      weight: 1,
      applicable: () => articleRows(TITLE).length > 0,
      gen: (rnd) => ({ row: rnd.int(3), value: rnd.pick(['3', '13', '', 'x', '2']) }),
      run: (ctx, { row, value }) => { const list = articleRows(TITLE); const i = row % list.length; return typeInto(ctx, list[i].querySelector('input'), value, `qty:${i}`); },
    },
    removeArticle: {
      weight: 1,
      applicable: () => articleRows(TITLE).length > 0,
      gen: (rnd) => ({ row: rnd.int(3) }),
      async run(ctx, { row }) {
        const list = articleRows(TITLE);
        [...ctx.typed.keys()].filter((k) => k.startsWith('qty:')).forEach((k) => ctx.typed.delete(k));
        return press(ctx, [...list[row % list.length].querySelectorAll('button')].find((b) => b.textContent === 'Retirer'));
      },
    },
    mode: {
      weight: 1,
      applicable: () => Boolean([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Pas maintenant')),
      gen: (rnd) => ({ now: rnd.next() < 0.6 }),
      async run(ctx, { now }) {
        ctx.tenderSnap = null; ctx.shortSnap = null; ctx.tickSnap.clear();
        return press(ctx, [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === (now ? 'Encaisser' : 'Pas maintenant')));
      },
    },
    tick: {
      weight: 2,
      applicable: () => Boolean(invoiceBox() && !invoiceBox().disabled),
      async run(ctx) {
        const box = invoiceBox();
        const ok = await press(ctx, box);
        if (ok) ctx.tickSnap.set('invoice', box.checked);
        return ok;
      },
    },
    retry: retryOp,
    commit: { weight: 2, commit: true, applicable: () => Boolean(validateButton()), run: (ctx) => press(ctx, validateButton()) },
    remount: remountOp(ready),
  },
};

// Seeds found by the long run (loop t26, 2026-11-19): a draft back to its answered value asked the invoice question / showed a save over a
// re-ask in flight; fixed in useLatestPreview (no re-ask of a draft already asked or answered).
test('the outside visit\'s arrival keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, [3, 60], [8, 60], [110, 60], [229, 60], [402, 60], [782, 60], [895, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(180000));
