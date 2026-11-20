// specs/plugins-phase-1-sdk.md rule 58 (loop t26 verifier) — the money-dialog invariants I1-I6, generated: « Ajouter un produit » on the
// fiche (`AddProductDialog`: its price quote and the sale). The driver and the invariants are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../api';
import AddProductDialog from '../components/AddProductDialog';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, typeInto, fieldByLabel, actionButton, retryOp, remountOp,
  focusOn, flush,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());

const ARTICLES = [{ articleRef: 'option:7', label: 'Bière locale', unitCents: 637 }, { articleRef: 'option:8', label: 'Bois', unitCents: 1213 }];
const keyOf = (body) => (body.requests || []).map((r) => `${r.articleRef}x${r.quantity}`).join(',');
function quoteOf(body) {
  const [r] = body.requests;
  const article = ARTICLES.find((a) => a.articleRef === r.articleRef);
  return { totalCents: article.unitCents * r.quantity, lines: [{ momentLabel: 'Au départ', merged: r.quantity > 3, note: null }] };
}
// The product select is the dialog's only combobox.
const combo = () => document.querySelector('[role="dialog"] [role="combobox"]');
function screenKey() {
  const box = combo();
  const label = box ? box.textContent.trim() : '';
  const article = ARTICLES.find((a) => a.label === label);
  const qty = Number((fieldByLabel('Quantité') || {}).value);
  return article && qty > 0 ? `${article.articleRef}x${qty}` : null;
}
const submit = () => actionButton(/^Ajouter$/);

const adapter = {
  name: 'AddProductDialog',
  fixtures: ARTICLES,
  tenders: false,
  routes: () => ({
    quoteExtraSale: { kind: 'preview', channel: 'quote', key: (_id, body) => keyOf(body), answer: (_id, body) => quoteOf(body) },
    sellExtra: { kind: 'commit', answer: () => ({ saleDetail: {} }) },
  }),
  render: (ctx) => <AddProductDialog open onClose={() => { ctx.closed = true; }} reservationId={7} articles={ARTICLES} onSold={() => { ctx.done = true; }} />,
  ready: () => Boolean(combo()),
  channels: [{ name: 'quote', key: screenKey, failureWords: (req) => [req.message, /Prix indisponible/] }],
  commitButton: submit,
  findTyped: (_ctx, ident) => { const el = fieldByLabel(ident); return el ? [el] : []; },
  liveness: (ctx) => {
    const button = submit();
    return button && button.disabled && ctx.states.quote.kind === 'fresh' ? '« Ajouter » disabled on a fresh price' : null;
  },
  snapshot: () => ({ key: screenKey() }),
  commitCheck: (ctx, req, snap) => {
    const [, body] = req.args;
    const out = [];
    if (keyOf(body) !== snap.key) out.push(`the sale sent ${keyOf(body)} for ${snap.key} on screen`);
    const fresh = (req.freshAtClick || {}).quote;
    if (!fresh || fresh.answer.totalCents !== body.acceptedTotalCents) out.push(`the sale accepted ${body.acceptedTotalCents} without a fresh price for it`);
    return out;
  },
  ops: {
    product: {
      weight: 3,
      gen: (rnd) => ({ label: rnd.pick(ARTICLES.map((a) => a.label)) }),
      async run(ctx, { label }) {
        const box = combo();
        if (!box) return false;
        focusOn(box);
        ctx.focusedOnce = true;
        fireEvent.mouseDown(box);
        await flush();
        const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === label);
        if (!option) return false;
        fireEvent.click(option);
        await flush();
        return true;
      },
    },
    quantity: {
      weight: 3,
      gen: (rnd) => ({ value: rnd.pick(['1', '2', '4', '', '0', '7']) }),
      run: (ctx, { value }) => typeInto(ctx, fieldByLabel('Quantité'), value, 'Quantité'),
    },
    retry: retryOp,
    commit: { weight: 2, commit: true, run: (ctx) => press(ctx, submit()) },
    remount: remountOp(() => Boolean(combo())),
  },
};

test('« Ajouter un produit » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, 2, [209, 60], [210, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(90000));
