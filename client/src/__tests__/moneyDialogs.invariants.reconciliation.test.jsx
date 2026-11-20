// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: the reconciliation dialogs of
// online-payment, « Répartir le versement » (`SplitSharesDialog`) and « Rattacher des virements » (`LinkTransactionDialog`). The driver and
// the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { vi } from 'vitest';
import api from '../api';
import SplitSharesDialog from '../plugins/online-payment/SplitSharesDialog';
import LinkTransactionDialog from '../plugins/online-payment/LinkTransactionDialog';
import {
  centsIn, runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, typeInto, fieldByLabel, actionButton, retryOp, remountOp,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());

// The field's reading, as the dialogs send it (`parseEuroInput`).
const parse = (text) => {
  const v = String(text ?? '').replace(/[\s€]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const [int, dec = ''] = v.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
};
const euros = (c) => `${Math.floor(c / 100)},${String(c % 100).padStart(2, '0')} €`;
const AMOUNTS = ['', '418,00', '252', '252,', '300,5', 'abc', '0', '700', '418,123', '282,00'];

// ------------------------------------------------------------------------------------------------ « Répartir le versement »
const PROPOSAL = {
  id: 'p:7|balance,8|balance', bank: { transactionId: 'p', amountCents: 70000, dateLabel: '15/10' },
  pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41800 }, { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25100 }],
};
const LABELS = { '7|balance': 'Séjour 7', '8|balance': 'Séjour 8' };
const splitKey = (pairs) => pairs.map((p) => p.amountCents).join('+');
function splitAnswer({ pairs }) {
  const total = pairs.reduce((s, p) => s + p.amountCents, 0);
  const gap = 70000 - total;
  const errors = gap === 0 ? [] : [{ code: 'SHARES_DO_NOT_SUM', field: 'shares', message: gap > 0 ? `Il manque ${euros(gap)} : les parts doivent faire 700,00 €.` : `${euros(-gap)} de trop : les parts doivent faire 700,00 €.` }];
  return { valid: errors.length === 0, pairs, receipts: [], leftover: [], totalCents: total, creditCount: 1, summaryLabel: `1 virement · ${euros(total)}`, errors };
}
const splitFields = () => ['Séjour 7 (€)', 'Séjour 8 (€)'].map((l) => fieldByLabel(l));
const splitScreen = () => {
  const texts = splitFields().map((f) => (f ? f.value : ''));
  const cents = texts.map(parse);
  return cents.some((c) => c == null) ? null : cents.join('+');
};
const splitSubmit = () => actionButton('Répartir et confirmer');
const split = {
  name: 'SplitSharesDialog',
  fixtures: PROPOSAL,
  tenders: false,
  routes: () => ({
    previewReconciliationAllocation: {
      kind: 'preview', channel: 'shares', key: (body) => splitKey(body.pairs), answer: (body) => splitAnswer(body),
      silent: (body) => ({ ...splitAnswer(body), valid: false, errors: [] }),
    },
  }),
  render: (ctx) => <SplitSharesDialog open onClose={() => {}} onSubmit={(body) => { ctx.state.submitted = body; }} proposal={PROPOSAL} labels={LABELS} />,
  ready: () => Boolean(fieldByLabel('Séjour 7 (€)')),
  channels: [{ name: 'shares', delay: 150, key: splitScreen, refusal: (a) => !a.valid }],
  // The server's answer is a function of the shares on screen: its figures for them are that draft's, whichever request brought them.
  derivedCents: () => {
    const key = splitScreen();
    if (!key) return [];
    const pairs = key.split('+').map((c) => ({ amountCents: Number(c) }));
    return [...centsIn(splitAnswer({ pairs }))];
  },
  commitButton: splitSubmit,
  findTyped: (_ctx, ident) => { const el = fieldByLabel(ident); return el ? [el] : []; },
  requirements: () => (splitScreen() == null ? ['a share unreadable'] : []),
  liveness: (ctx) => {
    const state = ctx.states.shares;
    const button = splitSubmit();
    return button && button.disabled && state.kind === 'fresh' && state.req.answer.valid ? '« Répartir et confirmer » disabled on a fresh valid answer' : null;
  },
  snapshot: () => ({ key: splitScreen() }),
  extraChecks: (ctx, v) => {
    if (ctx.state.submitted && !ctx.state.submittedChecked) {
      ctx.state.submittedChecked = true;
      const sent = splitKey(ctx.state.submitted.pairs);
      const fresh = ctx.freshAnswer('shares');
      if (!fresh || fresh.state !== 'ok' || fresh.key !== sent) v.push({ code: 'I2', message: `the split sent ${sent} without a fresh answer for it` });
    }
  },
  ops: {
    share: {
      weight: 4,
      gen: (rnd) => ({ at: rnd.int(2), value: rnd.pick(AMOUNTS) }),
      run: (ctx, { at, value }) => typeInto(ctx, splitFields()[at], value, ['Séjour 7 (€)', 'Séjour 8 (€)'][at]),
    },
    retry: retryOp,
    commit: { weight: 2, commit: true, run: (ctx) => press(ctx, splitSubmit()) },
    remount: remountOp(() => Boolean(fieldByLabel('Séjour 7 (€)'))),
  },
};

// ------------------------------------------------------------------------------------------------ « Rattacher des virements »
const CREDITS = [
  { transactionId: 'tx-1', amountCents: 30000, remainingCents: 30000, dateLabel: '12/03', counterparty: 'M. OU MME ROSSI', reference: 'ACOMPTE', reasons: ['exact'], fitsKey: '7|deposit' },
  { transactionId: 'tx-2', amountCents: 5037, remainingCents: 5037, dateLabel: '03/06', counterparty: 'Intérêts', reference: '', reasons: [] },
  { transactionId: 'tx-3', amountCents: 12011, remainingCents: 12011, dateLabel: '04/06', counterparty: 'Virement', reference: '', reasons: [] },
];
function creditsOf(q) {
  const query = String(q || '').trim();
  const hit = (c) => !query || c.dateLabel.includes(query) || c.counterparty.toLowerCase().includes(query.toLowerCase());
  const likely = CREDITS.slice(0, 1).filter(hit);
  const others = CREDITS.slice(1).filter(hit);
  return {
    receipts: [{ key: '7|deposit', label: 'Acompte', openCents: 30000, anchorDateLabel: 'avant le 14/03' }],
    likely, others: { total: others.length, offset: 0, items: others }, query: { tokens: query ? [query] : [] },
  };
}
const linkKey = (body) => (body.pairs ? `pairs:${body.pairs.map((p) => `${p.transactionId}=${p.amountCents}`).join(',')}` : `ids:${(body.transactionIds || []).join(',')}`);
function allocationOf(body) {
  const pairs = body.pairs || (body.transactionIds || []).map((id) => {
    const c = CREDITS.find((x) => x.transactionId === id);
    return { transactionId: id, reservationId: 7, ledgerKey: 'deposit', amountCents: c ? c.remainingCents : 0 };
  });
  const total = pairs.reduce((s, p) => s + p.amountCents, 0);
  const errors = pairs.flatMap((p, i) => {
    const c = CREDITS.find((x) => x.transactionId === p.transactionId);
    return c && p.amountCents > c.remainingCents ? [{ code: 'OVER_CREDIT', field: `pairs.${i}`, message: `Au plus ${euros(c.remainingCents)}.` }] : [];
  });
  return {
    valid: errors.length === 0 && total > 0, pairs,
    receipts: [{ key: '7|deposit', label: 'Acompte', expectedCents: 30000, coveredCents: Math.min(total, 30000), after: total >= 30000 ? 'covered' : 'partial', statusLabel: total >= 30000 ? 'couvert' : `${euros(30000 - Math.min(total, 30000))} restants` }],
    leftover: [], totalCents: total, creditCount: pairs.length, summaryLabel: `${pairs.length} virement${pairs.length > 1 ? 's' : ''} · ${euros(total)}`, errors,
  };
}
const linkSubmit = () => actionButton('Rattacher');
const rowBoxes = () => [...document.querySelectorAll('[role="dialog"] label input[type="checkbox"]')];
const manualFields = () => [...document.querySelectorAll('[role="dialog"] input[inputmode="decimal"]')];
const rowId = (box) => {
  const text = box.closest('label').textContent;
  const c = CREDITS.find((x) => text.includes(x.dateLabel) && text.includes(x.counterparty));
  return c ? c.transactionId : null;
};
function linkScreen(ctx) {
  if (ctx.state.manual) {
    const cents = manualFields().map((f) => parse(f.value));
    if (cents.length === 0 || cents.some((c) => c == null)) return null;
    return `pairs:${ctx.state.manual.map((id, i) => `${id}=${cents[i]}`).join(',')}`;
  }
  return ctx.state.ticked && ctx.state.ticked.length ? `ids:${ctx.state.ticked.join(',')}` : null;
}
const link = {
  name: 'LinkTransactionDialog',
  fixtures: CREDITS,
  tenders: false,
  routes: () => ({
    getReconciliationFicheCredits: { kind: 'preview', channel: 'list', key: (_id, { q }) => `q:${q || ''}`, answer: (_id, { q }) => creditsOf(q) },
    previewReconciliationAllocation: {
      kind: 'preview', channel: 'allocation', key: (body) => linkKey(body), answer: (body) => allocationOf(body),
      silent: (body) => ({ ...allocationOf(body), valid: false }),
    },
  }),
  render: (ctx) => <LinkTransactionDialog open onClose={() => {}} onSubmit={(pairs) => { ctx.state.submitted = pairs; }} reservationId={7} />,
  ready: () => Boolean(document.querySelector('[role="dialog"] input[type="search"]')),
  setup: async (ctx) => { ctx.state.ticked = []; ctx.state.manual = null; ctx.state.query = ''; },
  onRemount: (ctx) => { ctx.state.ticked = []; ctx.state.manual = null; ctx.state.query = ''; },
  channels: [
    { name: 'list', delay: 250, key: (ctx) => `q:${ctx.state.query || ''}`, gates: false },
    { name: 'allocation', delay: 150, key: linkScreen, refusal: (a) => !a.valid },
  ],
  commitButton: linkSubmit,
  // The ticked rows must be on screen: a list that failed hides them, so « Rattacher » waits for it again (loop t23).
  requirements: (ctx) => (ctx.states.list.kind === 'failed' ? ['the list failed'] : []),
  findTyped: (_ctx, ident) => {
    if (ident.startsWith('manual:')) { const el = manualFields()[Number(ident.split(':')[1])]; return el ? [el] : []; }
    const el = document.querySelector('[role="dialog"] input[type="search"]');
    return ident === 'search' && el ? [el] : [];
  },
  liveness: (ctx) => {
    const a = ctx.states.allocation;
    const l = ctx.states.list;
    const button = linkSubmit();
    return button && button.disabled && a.kind === 'fresh' && a.req.answer.valid && l.kind === 'fresh' ? '« Rattacher » disabled on a fresh valid answer' : null;
  },
  extraChecks: (ctx, v) => {
    if (ctx.state.submitted && !ctx.state.submittedChecked) {
      ctx.state.submittedChecked = true;
      const fresh = ctx.freshAnswer('allocation');
      const sent = ctx.state.submitted.map((p) => `${p.transactionId}=${p.amountCents}`).join(',');
      const answered = fresh && fresh.state === 'ok' ? fresh.answer.pairs.map((p) => `${p.transactionId}=${p.amountCents}`).join(',') : null;
      if (sent !== answered) v.push({ code: 'I2', message: `« Rattacher » sent ${sent} without a fresh answer for it` });
    }
  },
  ops: {
    tick: {
      weight: 4,
      applicable: () => rowBoxes().some((b) => !b.disabled),
      gen: (rnd) => ({ at: rnd.int(3) }),
      async run(ctx, { at }) {
        const boxes = rowBoxes().filter((b) => !b.disabled);
        const box = boxes[at % boxes.length];
        const id = rowId(box);
        // The model moves with the click, before React commits it: the probe judges every commit against the draft clicked.
        const before = { ticked: ctx.state.ticked, manual: ctx.state.manual };
        const ok = await press(ctx, box, () => {
          if (!id) return;
          ctx.state.ticked = ctx.state.ticked.includes(id) ? ctx.state.ticked.filter((x) => x !== id) : [...ctx.state.ticked, id];
          ctx.state.manual = null;
        });
        if (!ok) { ctx.state.ticked = before.ticked; ctx.state.manual = before.manual; }
        if (ok && id) [...ctx.typed.keys()].filter((k) => k.startsWith('manual:')).forEach((k) => ctx.typed.delete(k));
        return ok;
      },
    },
    search: {
      weight: 1,
      gen: (rnd) => ({ value: rnd.pick(['', '12/03', 'zzz', 'Int']) }),
      async run(ctx, { value }) {
        const field = document.querySelector('[role="dialog"] input[type="search"]');
        if (!field || field.value === value) return false;
        ctx.state.query = value;
        return typeInto(ctx, field, value, 'search');
      },
    },
    modify: {
      weight: 2,
      applicable: () => Boolean([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Modifier la répartition')),
      async run(ctx) {
        const ids = (ctx.server.accepted.allocation && ctx.server.accepted.allocation.answer.pairs.map((p) => p.transactionId)) || [];
        const before = ctx.state.manual;
        const ok = await press(ctx, [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Modifier la répartition'), () => { ctx.state.manual = ids; });
        const shownPairs = manualFields().length;
        ctx.state.manual = ok && shownPairs ? ids.slice(0, shownPairs) : before;
        return ok;
      },
    },
    manualAmount: {
      weight: 3,
      applicable: () => manualFields().length > 0,
      gen: (rnd) => ({ at: rnd.int(3), value: rnd.pick(['300,00', '50,37', '120,', '350', 'x', '', '10,5']) }),
      async run(ctx, { at, value }) {
        const fields = manualFields();
        return typeInto(ctx, fields[at % fields.length], value, `manual:${at % fields.length}`);
      },
    },
    retry: retryOp,
    commit: { weight: 2, commit: true, run: (ctx) => press(ctx, linkSubmit()) },
    remount: remountOp(() => Boolean(document.querySelector('[role="dialog"] input[type="search"]'))),
  },
};

test('« Répartir le versement » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(split, api, { seeds: harnessSeeds([1, 2, 3, [383, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(180000));

test('« Rattacher des virements » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(link, api, { seeds: harnessSeeds([1, [273, 60], [275, 60], [289, 60], [309, 60], [328, 60], [389, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(180000));
