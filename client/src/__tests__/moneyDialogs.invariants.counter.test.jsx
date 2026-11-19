// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: « Vente hors séjour »
// (`StandaloneSaleDialog`). The driver and the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../api';
import StandaloneSaleDialog from '../components/StandaloneSaleDialog';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, typeInto, findButton, tenderBlocks, centsOfInput, remountOp,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());

const ARTICLES = [
  { articleRef: 'option:7', label: 'Bière locale', unitCents: 637, max: 12, category: 'Boissons' },
  { articleRef: 'option:8', label: 'Limonade', unitCents: 419, max: 5, category: 'Boissons' },
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const linesKey = (lines) => (lines || []).map((l) => `${l.articleRef}x${l.quantity}${l.offered ? 'o' : ''}`).join(',');
// The request names the customer as the dialog may send it (specs/plugins-phase-1-sdk.md rule 54 reading of 2026-11-19, loop t26 UI26-1):
// the address once it reads as one, « Enregistrer comme client » once a name is there. A change of it is a new request of the same amounts.
const customerKey = (c = {}) => [c.name || '', c.email || '', c.registerAsClient ? 'r' : ''].join('/');
const requestKey = (body) => `${linesKey(body.lines)}|${customerKey(body.customer)}`;
function screenCustomer() {
  const name = (field('Nom') || {}).value || '';
  const email = ((field('E-mail') || {}).value || '').trim();
  const register = Boolean(([...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')][0] || {}).checked);
  return { name: name.trim() || undefined, email: EMAIL.test(email) ? email : undefined, registerAsClient: register && name.trim() ? true : undefined };
}
function quoteOf(body) {
  const refusals = [];
  const lines = [];
  body.lines.forEach((entry, i) => {
    const article = ARTICLES.find((a) => a.articleRef === entry.articleRef);
    if (entry.quantity > article.max || entry.quantity < 1) {
      refusals.push({ articleRef: entry.articleRef, code: 'QUANTITY_OUT_OF_RANGE', message: `Entre 1 et ${article.max}.` });
      return;
    }
    const gross = entry.quantity * article.unitCents;
    lines.push({
      id: null, ref: `draft:${i}`, kind: 'extra', label: article.label, detail: `${entry.quantity} × ${(article.unitCents / 100).toFixed(2).replace('.', ',')} €`,
      quantity: entry.quantity, unitCents: article.unitCents, totalCents: entry.offered ? 0 : gross, catalogueCents: gross, offered: Boolean(entry.offered),
      status: entry.offered ? 'offered' : 'due', statusLabel: entry.offered ? 'Offert' : 'À payer',
    });
  });
  const total = lines.reduce((s, l) => s + l.totalCents, 0);
  const email = body.customer && body.customer.email;
  return {
    document: { lines, totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 }, vatByRate: [{ rate: 20, vatCents: Math.round(total / 6) }] },
    customer: { clientId: null, label: body.customer && body.customer.name ? body.customer.name : 'Passage', kind: 'passage' },
    refusals,
    paymentLink: { available: true, reason: email ? null : 'NO_EMAIL', email: email || null, open: null },
  };
}

const rows = () => [...document.querySelectorAll('ul[aria-label="Articles"] > li')];
// The quantity a row stands for while its field holds no number (typed '' or 'x'): the last number that very field showed (a row keeps
// its field until it is removed).
let qtyCache = new WeakMap();
function draftKey() {
  return rows().map((row) => {
    const name = row.querySelector('p').textContent;
    const article = ARTICLES.find((a) => a.label === name);
    const offered = row.querySelector('button[aria-pressed="true"]') ? 'o' : '';
    const input = row.querySelector('input');
    let quantity = input && /^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : qtyCache.get(input);
    if (quantity != null && input) qtyCache.set(input, quantity);
    if (quantity == null) quantity = 1;
    return `${article ? article.articleRef : name}x${quantity}${offered}`;
  }).join(',');
}
const field = (label) => [...document.querySelectorAll('[role="dialog"] input')].find((i) => i.labels && i.labels[0] && i.labels[0].textContent.replace('*', '').trim() === label);
const submit = () => [...document.querySelectorAll('[role="dialog"] .MuiDialogActions-root button')].find((b) => /^Enregistrer/.test(b.textContent.trim()));

const adapter = {
  name: 'StandaloneSaleDialog',
  fixtures: ARTICLES,
  routes: () => ({
    getSuggestedArticlesCatalogue: { kind: 'read', answer: () => ({ articles: ARTICLES, groups: [{ category: 'Boissons', articles: ARTICLES }] }) },
    quoteStandaloneSale: {
      kind: 'preview', channel: 'quote', key: (body) => requestKey(body), answer: (body) => quoteOf(body),
      silent: (body) => ({ ...quoteOf(body), paymentLink: { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null } }),
    },
    sellStandaloneSale: { kind: 'commit', answer: (body) => ({ sale: { id: 1, clientLabel: 'Passage', lines: [], totalCents: body.acceptedTotalCents, statusLabel: 'Payée' }, document: { document: { id: 1 } }, paymentLink: null }) },
    mintStandaloneSaleLink: { kind: 'read', answer: () => ({}) },
  }),
  render: () => <StandaloneSaleDialog open onClose={() => {}} onSold={() => {}} />,
  ready: () => Boolean([...document.querySelectorAll('[role="dialog"] [role="button"]')].find((b) => /Bière locale/.test(b.textContent))),
  setup: () => { qtyCache = new WeakMap(); },
  channels: [{
    name: 'quote',
    key: () => (rows().length ? `${draftKey()}|${customerKey(screenCustomer())}` : null),
    refusal: (answer) => answer.refusals.length > 0,
    failureWords: (req) => [req.message],
  }],
  commitButton: submit,
  findTyped: (_ctx, ident) => {
    if (ident.startsWith('qty:')) {
      const [, index] = ident.split(':');
      const row = rows()[Number(index)];
      return row ? [row.querySelector('input')] : [];
    }
    const el = field(ident);
    return el ? [el] : [];
  },
  requirements: () => {
    const out = [];
    const email = field('E-mail');
    if (email && email.value.trim() && !EMAIL.test(email.value.trim())) out.push('invalid e-mail');
    const register = [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')][0];
    const name = field('Nom');
    if (register && register.checked && name && !name.value.trim()) out.push('register without a name');
    return out;
  },
  nominal: (ctx) => {
    const state = ctx.states.quote;
    const known = state.kind === 'fresh' && state.req.answer.refusals.length === 0 && state.req.answer.document.totals.remainingCents > 0;
    return { known, elements: [document.querySelector('[data-testid="sale-total"]')] };
  },
  dueOf: (ctx) => {
    const state = ctx.states.quote;
    const dues = [];
    if (state.kind === 'fresh') dues.push(state.req.answer.document.totals.remainingCents);
    if (state.kind === 'pending' && ctx.server.accepted.quote) dues.push(ctx.server.accepted.quote.answer.document.totals.remainingCents);
    return dues;
  },
  liveness: (ctx, blocks) => {
    const button = submit();
    const state = ctx.states.quote;
    if (!button || !button.disabled || state.kind !== 'fresh' || ctx.server.pending().some((r) => r.kind === 'commit')) return null;
    const answer = state.req.answer;
    if (answer.refusals.length || adapter.requirements(ctx).length) return null;
    const linkMode = [...document.querySelectorAll('[role="dialog"] button[aria-pressed="true"]')].some((b) => b.textContent === 'Envoyer un lien');
    if (linkMode && answer.paymentLink.reason) return null;
    const block = blocks[0];
    if (answer.document.totals.remainingCents > 0 && !linkMode) {
      if (!block || !(block.covered || (block.short && block.shortfall)) || block.lines.some((l) => centsOfInput(l.value) == null && l.value.trim() !== '')) return null;
      if (block.lines.some((l) => !l.auto && (centsOfInput(l.value) || 0) <= 0)) return null;
    }
    return `« ${button.textContent.trim()} » disabled on a fresh answer with every question answered`;
  },
  snapshot: () => {
    const block = tenderBlocks(document.body)[0];
    return {
      key: draftKey(),
      tenders: block ? block.lines.map((l) => ({ method: l.method, cents: centsOfInput(l.value) })).filter((t) => t.cents) : null,
      shortfall: block && block.short ? block.shortfall : null,
    };
  },
  commitCheck: (ctx, req, snap) => {
    const out = [];
    const [body] = req.args;
    if (linesKey(body.lines) !== snap.key) out.push(`the sale sent lines ${linesKey(body.lines)} for the draft ${snap.key} on screen`);
    const fresh = ctx.server.lastOf('quote');
    if (fresh && fresh.state === 'ok' && body.acceptedTotalCents !== fresh.answer.document.totals.totalCents) out.push(`the sale accepted ${body.acceptedTotalCents} for a quote of ${fresh.answer.document.totals.totalCents}`);
    if (body.payment && snap.tenders) {
      const sent = body.payment.tenders.map((t) => `${t.method}:${t.amountCents}`).join('|');
      const shown = snap.tenders.map((t) => `${t.method}:${t.cents}`).join('|');
      if (sent !== shown) out.push(`the sale sent tenders ${sent} for ${shown} on screen`);
      const kind = body.payment.shortfall ? body.payment.shortfall.kind : null;
      if (kind !== snap.shortfall) out.push(`the sale sent shortfall ${kind} for ${snap.shortfall} on screen`);
    }
    return out;
  },
  afterCommitOk: async (ctx) => { ctx.done = true; },
  ops: {
    addArticle: {
      weight: 4,
      gen: (rnd) => ({ label: rnd.pick(['Bière locale', 'Limonade']) }),
      async run(ctx, { label }) {
        const chip = [...document.querySelectorAll('[role="dialog"] [role="button"]')].find((b) => b.textContent.startsWith(label) && b.classList.contains('MuiChip-root'));
        [...ctx.typed.keys()].filter((k) => k.startsWith('qty:')).forEach((k) => ctx.typed.delete(k));
        return press(ctx, chip);
      },
    },
    stepper: {
      weight: 3,
      applicable: () => rows().length > 0,
      gen: (rnd) => ({ row: rnd.int(4), more: rnd.next() < 0.6 }),
      async run(ctx, { row, more }) {
        const list = rows();
        const target = list[row % list.length];
        const button = target && [...target.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === (more ? 'Un de plus' : 'Un de moins'));
        if (!button || button.disabled) return false;
        ctx.typed.delete(`qty:${row % list.length}`);
        return press(ctx, button);
      },
    },
    typeQuantity: {
      weight: 2,
      applicable: () => rows().length > 0,
      gen: (rnd) => ({ row: rnd.int(4), value: rnd.pick(['3', '7', '13', '', '0', 'x', '2']) }),
      async run(ctx, { row, value }) {
        const list = rows();
        const index = row % list.length;
        const input = list[index] && list[index].querySelector('input');
        return typeInto(ctx, input, value, `qty:${index}`);
      },
    },
    offer: {
      weight: 1,
      applicable: () => rows().length > 0,
      gen: (rnd) => ({ row: rnd.int(4) }),
      async run(ctx, { row }) {
        const list = rows();
        const target = list[row % list.length];
        return press(ctx, target && [...target.querySelectorAll('button')].find((b) => /^Offr/.test(b.textContent)));
      },
    },
    remove: {
      weight: 1,
      applicable: () => rows().length > 0,
      gen: (rnd) => ({ row: rnd.int(4) }),
      async run(ctx, { row }) {
        const list = rows();
        const target = list[row % list.length];
        [...ctx.typed.keys()].filter((k) => k.startsWith('qty:')).forEach((k) => ctx.typed.delete(k));
        return press(ctx, target && [...target.querySelectorAll('button')].find((b) => b.textContent === 'Retirer'));
      },
    },
    typeName: {
      weight: 1,
      gen: (rnd) => ({ value: rnd.pick(['', 'Lou', 'Jean Dupont']) }),
      run: (ctx, { value }) => typeInto(ctx, field('Nom'), value, 'Nom'),
    },
    typeEmail: {
      weight: 2,
      gen: (rnd) => ({ value: rnd.pick(['', 'c', 'client@', 'client@exemple', 'client@exemple.fr', 'autre@exemple.fr']) }),
      run: (ctx, { value }) => typeInto(ctx, field('E-mail'), value, 'E-mail'),
    },
    register: {
      weight: 1,
      run: (ctx) => press(ctx, [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')][0]),
    },
    mode: {
      weight: 1,
      applicable: () => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent === 'Envoyer un lien'),
      gen: (rnd) => ({ link: rnd.next() < 0.5 }),
      async run(ctx, { link }) {
        const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === (link ? 'Envoyer un lien' : 'Encaisser maintenant'));
        ctx.tenderSnap = null;
        ctx.shortSnap = null;
        return press(ctx, button);
      },
    },
    retry: {
      weight: 3,
      applicable: (ctx) => Boolean(findButton(ctx, 'Réessayer')),
      run: (ctx) => press(ctx, findButton(ctx, 'Réessayer')),
    },
    commit: {
      weight: 2,
      commit: true,
      applicable: () => Boolean(submit()),
      run: (ctx) => press(ctx, submit()),
    },
    remount: remountOp(() => adapter.ready()),
  },
};

test('« Vente hors séjour » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, 2, 3, 4, 5, 6]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout());

