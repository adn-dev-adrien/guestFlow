// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: « Nouvelle note »
// (`MidStayNoteDialog`). The driver and the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { vi } from 'vitest';
import api from '../api';
import MidStayNoteDialog from '../components/reservation/MidStayNoteDialog';
import { ReservationFormProvider } from '../components/reservation/ReservationFormContext';
import { makeMockContext } from '../components/reservation/__tests__/mockReservationForm';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, actionButton, retryOp, remountOp, tenderBlocks, centsOfInput,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());

const LINES = [
  { label: 'Petit-déjeuner', amount: 24.13, key: 'opt:9', source: 'midStayExtra' },
  { label: 'Location vélo', amount: 18.37, key: 'res:3', source: 'midStayExtra' },
  { label: 'Bois', amount: 7.05, key: 'opt:4', source: 'midStayExtra' },
];
const sortedKeys = (keys) => [...keys].sort().join(',');
const noteOf = ({ checkedKeys }) => {
  const items = checkedKeys.map((key) => ({ key, amount: LINES.find((l) => l.key === key).amount }));
  return { items, total: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100 };
};
const boxes = () => [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].filter((b) => !b.closest('[data-tender-line]')).slice(0, LINES.length);
const checkedOnScreen = () => boxes().map((b, i) => (b.checked ? LINES[i].key : null)).filter(Boolean);
const settleButtons = () => ['CB / Chèque', 'Caisse interne', /^Encaisser/].map((n) => actionButton(n)).filter(Boolean);
const dueOfAnswer = (req) => Math.round(Number(req.answer.total) * 100);

const adapter = {
  name: 'MidStayNoteDialog',
  fixtures: LINES,
  staticCents: [1000],
  routes: () => ({
    previewMidStayNote: { kind: 'preview', channel: 'note', key: (body) => sortedKeys(body.checkedKeys), answer: (body) => noteOf(body) },
  }),
  render: (ctx) => (
    <ReservationFormProvider value={makeMockContext({ editingReservationId: 7, pricingQuote: { midStayExtrasLines: LINES } })}>
      <MidStayNoteDialog
        open
        onClose={() => { ctx.closed = true; }}
        pendingLines={LINES}
        onSettle={(instruction, cash, split) => ctx.server.prop('onSettle', [instruction, cash, split])}
        onSellOnly={() => ctx.server.prop('onSellOnly', [])}
      />
    </ReservationFormProvider>
  ),
  ready: () => boxes().length === LINES.length,
  channels: [{ name: 'note', key: () => sortedKeys(checkedOnScreen()), failureWords: (req) => [req.message] }],
  commitButton: settleButtons,
  tendersOutsideCommit: (_b, commit) => !/^Encaisser/.test(commit.textContent),
  requirements: (ctx, commit) => {
    const state = ctx.states.note;
    return state.kind === 'fresh' && !(state.req.answer.total > 0) ? ['nothing to settle'] : [];
  },
  dueOf: (ctx) => {
    const state = ctx.states.note;
    const dues = [];
    if (state.kind === 'fresh') dues.push(dueOfAnswer(state.req));
    if (state.kind === 'pending' && ctx.server.accepted.note) dues.push(dueOfAnswer(ctx.server.accepted.note));
    return dues;
  },
  nominal: (ctx) => {
    const state = ctx.states.note;
    return { known: state.kind === 'fresh' && state.req.answer.total > 0, elements: [document.querySelector('[data-testid="note-total"]'), actionButton(/^Encaisser/)] };
  },
  liveness: (ctx, blocks) => {
    const state = ctx.states.note;
    if (state.kind !== 'fresh' || !(state.req.answer.total > 0) || ctx.server.pending().some((r) => r.kind === 'commit')) return null;
    const collect = actionButton(/^Encaisser/);
    if (collect) {
      const b = blocks[0];
      if (!collect.disabled || !b || !(b.covered || (b.short && b.shortfall)) || b.lines.some((l) => !l.auto && !(centsOfInput(l.value) > 0))) return null;
      return `« ${collect.textContent} » disabled on a fresh answer with covering lines`;
    }
    const card = actionButton('CB / Chèque');
    return card && card.disabled ? '« CB / Chèque » disabled on a fresh answer' : null;
  },
  snapshot: () => {
    const block = tenderBlocks(document.body)[0];
    return {
      key: sortedKeys(checkedOnScreen()),
      tenders: block ? block.lines.map((l) => ({ method: l.method, cents: centsOfInput(l.value) })).filter((t) => t.cents) : null,
      shortfall: block && block.short ? block.shortfall : null,
    };
  },
  commitCheck: (ctx, req, snap) => {
    if (req.name !== 'onSettle') return [];
    const out = [];
    const [instruction, , split] = req.args;
    if (sortedKeys(instruction.checkedKeys) !== snap.key) out.push(`the note settled ${sortedKeys(instruction.checkedKeys)} for ${snap.key} on screen`);
    if (split) {
      const fresh = ctx.server.lastOf('note');
      if (!fresh || fresh.state !== 'ok' || split.expectedAmountCents !== dueOfAnswer(fresh)) out.push(`the note expected ${split.expectedAmountCents} without a fresh answer for it`);
      const sent = split.tenders.map((t) => `${t.method}:${t.amountCents}`).join('|');
      const shown = (snap.tenders || []).map((t) => `${t.method}:${t.cents}`).join('|');
      if (sent !== shown) out.push(`the note sent tenders ${sent} for ${shown} on screen`);
      const kind = split.shortfall ? split.shortfall.kind : null;
      if (kind !== snap.shortfall) out.push(`the note sent shortfall ${kind} for ${snap.shortfall} on screen`);
    }
    return out;
  },
  afterCommitOk: async (ctx) => { ctx.done = true; },
  ops: {
    tick: {
      weight: 4,
      gen: (rnd) => ({ at: rnd.int(LINES.length) }),
      run: (ctx, { at }) => press(ctx, boxes()[at]),
    },
    split: {
      weight: 2,
      applicable: () => Boolean(document.querySelector('[data-split-toggle="note"]:not([disabled])')),
      async run(ctx) {
        ctx.tenderSnap = null;
        ctx.shortSnap = null;
        return press(ctx, document.querySelector('[data-split-toggle="note"]'));
      },
    },
    settle: {
      weight: 2,
      commit: true,
      applicable: () => settleButtons().length > 0,
      gen: (rnd) => ({ at: rnd.int(2) }),
      run: (ctx, { at }) => { const list = settleButtons(); return press(ctx, list[at % list.length]); },
    },
    retry: retryOp,
    remount: remountOp(() => boxes().length === LINES.length),
  },
};

test('« Nouvelle note » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, 2, 3, 4, 5]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout());
