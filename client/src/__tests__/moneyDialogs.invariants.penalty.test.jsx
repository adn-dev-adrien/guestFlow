// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: « Pénalité plateforme »
// (`PlatformPenaltyDialog`). The driver and the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { vi } from 'vitest';
import api from '../api';
import DialogProvider from '../components/DialogProvider';
import PlatformPenaltyDialog from '../components/reservation/PlatformPenaltyDialog';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, typeInto, fieldByLabel, actionButton, typedIdent, retryOp, remountOp,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());

// The field's reading, as the dialog sends it (a trailing separator is the whole amount, two decimals at most).
const toAmount = (text) => {
  const v = String(text ?? '').replace(/[\s€]/g, '').replace(',', '.');
  return /^\d+(\.\d{0,2})?$/.test(v) ? Number(v) : null;
};
const key = (body) => JSON.stringify([body.amount, body.reason || '', body.date || '', body.payoutIncludesPenalty ?? null]);
function previewOf(body) {
  const amount = Number(body.amount) || 0;
  const needsChoice = amount >= 20;
  const errors = [];
  if (!String(body.reason || '').trim()) errors.push({ field: 'reason', code: 'REASON_REQUIRED', message: 'Motif requis.' });
  if (amount > 300) errors.push({ field: 'amount', code: 'AMOUNT_TOO_HIGH', message: 'Pénalité supérieure au versement.' });
  if (needsChoice && body.payoutIncludesPenalty == null) errors.push({ field: 'payoutIncludesPenalty', code: 'CHOICE_REQUIRED', message: 'Choisir.' });
  const after = body.payoutIncludesPenalty ? 610.02 : 570.02;
  return {
    valid: errors.length === 0, needsChoice, warnings: [], errors,
    before: { payout: 570.02, commission: 229.98, netReceived: 570.02 },
    after: { payout: after, commission: Math.round((229.98 - amount) * 100) / 100, netReceived: Math.round((570.02 - (body.payoutIncludesPenalty ? 0 : amount)) * 100) / 100 },
  };
}
const screenBody = () => {
  const amount = toAmount((fieldByLabel('Montant (€)') || {}).value);
  const reason = (fieldByLabel('Motif') || {}).value || '';
  const radios = [...document.querySelectorAll('[role="dialog"] input[type="radio"]')];
  const on = radios.find((r) => r.checked);
  return { amount, reason, payoutIncludesPenalty: on ? on.value === 'true' : undefined };
};
const submit = () => actionButton('Enregistrer');

const adapter = {
  name: 'PlatformPenaltyDialog',
  fixtures: { initialAmount: 40 },
  routes: () => ({
    listPlatformPenalties: { kind: 'read', answer: () => ({ items: [], suggestions: ['Annulation tardive'] }) },
    previewPlatformPenalty: {
      kind: 'preview', channel: 'preview', key: (_id, body) => key(body), answer: (_id, body) => previewOf(body),
      silent: (_id, body) => ({ ...previewOf(body), valid: false, errors: [] }),
    },
    declarePlatformPenalty: { kind: 'commit', answer: () => ({ ok: true }) },
  }),
  render: () => <DialogProvider><PlatformPenaltyDialog open onClose={() => {}} reservationId={7} source="fiche" onDone={() => {}} initialAmount={40} /></DialogProvider>,
  ready: () => Boolean(fieldByLabel('Montant (€)')),
  channels: [{
    name: 'preview',
    delay: 250,
    key: () => { const b = screenBody(); return b.amount != null && b.amount > 0 ? key(b) : null; },
    refusal: (answer) => !answer.valid,
  }],
  commitButton: submit,
  findTyped: typedIdent,
  requirements: () => (toAmount((fieldByLabel('Montant (€)') || {}).value) == null ? ['amount unreadable'] : []),
  liveness: (ctx) => {
    const button = submit();
    const state = ctx.states.preview;
    if (!button || !button.disabled || state.kind !== 'fresh' || !state.req.answer.valid || ctx.server.pending().some((r) => r.kind === 'commit')) return null;
    return '« Enregistrer » disabled on a fresh valid answer';
  },
  snapshot: () => ({ key: key(screenBody()) }),
  commitCheck: (_ctx, req, snap) => (key(req.args[1]) !== snap.key ? [`the penalty sent ${key(req.args[1])} for ${snap.key} on screen`] : []),
  afterCommitOk: async (ctx) => { ctx.done = true; },
  tenders: false,
  ops: {
    amount: {
      weight: 4,
      gen: (rnd) => ({ value: rnd.pick(['', '30', '30,', '30,5', '30,123', '0', 'abc', '12,40', '15', '400', '40']) }),
      run: (ctx, { value }) => typeInto(ctx, fieldByLabel('Montant (€)'), value, 'Montant (€)'),
    },
    reason: {
      weight: 2,
      gen: (rnd) => ({ value: rnd.pick(['', 'Annulation tardive', 'Frais']) }),
      run: (ctx, { value }) => typeInto(ctx, fieldByLabel('Motif'), value, 'Motif'),
    },
    choice: {
      weight: 2,
      applicable: () => document.querySelectorAll('[role="dialog"] input[type="radio"]').length > 0,
      gen: (rnd) => ({ at: rnd.int(2) }),
      run: (ctx, { at }) => press(ctx, [...document.querySelectorAll('[role="dialog"] input[type="radio"]')][at]),
    },
    retry: retryOp,
    commit: { weight: 2, commit: true, run: (ctx) => press(ctx, submit()) },
    remount: remountOp(() => Boolean(fieldByLabel('Montant (€)'))),
  },
};

test('« Pénalité plateforme » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, 2, 3, 4, 15, 24, [250, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(120000));
