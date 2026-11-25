// specs/plugins-phase-1-sdk.md rule 58, specs/gift-voucher-campaigns.md rules 41, 52 — the money-dialog invariants I1-I6, generated: « Nouveau bon »
// (`NewVoucherPage`): the server's price of the campaign chosen, its extra time and add-ons, and « Créer le bon ». The driver and the invariants
// are in `moneyDialogsHarness.jsx`.
import React from 'react';
import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../api';
import NewVoucherPage from '../plugins/gift-vouchers/NewVoucherPage';
import { OFFER, Shell } from '../plugins/gift-vouchers/__tests__/giftVoucherFixtures';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, retryOp, remountOp,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());
// The plugin's API module goes through the same fake server: each call is a route of its own.
vi.mock('../plugins/gift-vouchers/giftVouchersApi', async () => {
  const { default: harnessApi } = await import('../api');
  return {
    default: {
      getOffer: () => harnessApi.giftOffer(),
      listVisuals: () => harnessApi.giftVisuals(),
      catalogue: () => harnessApi.giftCatalogue(),
      offerPrice: (body, options) => harnessApi.giftOfferPrice(body, options),
      previewPrice: (body, options) => harnessApi.giftPreviewPrice(body, options),
      create: (body) => harnessApi.giftCreate(body),
      visualImageUrl: () => '/img',
    },
  };
});

const BATH = OFFER.campaigns[0];
const DRINK = BATH.addOns[0];
const keyOf = (body) => JSON.stringify([body.slug, body.extraMinutes, body.addOns]);
function priceOf(body) {
  const extra = (Number(body.extraMinutes) / 60) * 4500;
  const drinks = (body.addOns || []).reduce((sum, a) => sum + a.qty * 650, 0);
  const lines = [
    { kind: 'session', label: 'Bain nordique · journée', qty: 1, unitCents: 9000 + extra, totalCents: 9000 + extra, vatRate: 20 },
    { kind: 'option', label: 'Planche apéro', qty: 1, unitCents: 1900, totalCents: 1900, vatRate: 10 },
    ...(drinks ? [{ kind: 'option', label: DRINK.label, qty: drinks / 650, unitCents: 650, totalCents: drinks, vatRate: 20 }] : []),
  ];
  const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  return { lines, totalCents, vat: [{ rate: 20, cents: Math.round((9000 + extra + drinks) / 6) }, { rate: 10, cents: 173 }] };
}
// Rule 64: the extras sit in a fold, closed by default; the page is « ready » once the fold has been opened.
const foldOpened = () => {
  const head = [...document.querySelectorAll('button[aria-expanded]')].find((b) => /Ajouter au bon/.test(b.getAttribute('aria-label') || ''));
  if (head && head.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
  return Boolean(head);
};
const inputOf = (name) => [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === name);
const steppers = (name) => [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === name);
// The extra time comes first on the page, the drink's quantity second: each stepper commits at once.
const screenKey = () => {
  const extra = inputOf('Temps en plus');
  const qty = inputOf('Boisson');
  if (!extra || !qty) return null;
  const drinks = Number(qty.value) || 0;
  return JSON.stringify([BATH.slug, Number(extra.value) || 0, drinks > 0 ? [{ articleRef: DRINK.articleRef, qty: drinks }] : []]);
};
const submit = () => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Créer le bon');
const stepperOp = (name, index) => ({
  weight: 3,
  applicable: () => Boolean(steppers(name)[index]) && !steppers(name)[index].disabled,
  run: (ctx) => press(ctx, steppers(name)[index]),
});

const adapter = {
  name: 'NewVoucherPage',
  fixtures: OFFER,
  tenders: false,
  scope: () => [document.body],
  routes: () => ({
    giftOffer: { kind: 'read', answer: () => OFFER },
    giftVisuals: { kind: 'read', answer: () => ({ items: [] }) },
    giftCatalogue: { kind: 'read', answer: () => ({ elements: [] }) },
    getToday: { kind: 'read', answer: () => ({ today: '2026-11-15' }) }, // date-literal-ok: the server's today the page shows as the sale date
    giftOfferPrice: { kind: 'preview', channel: 'price', key: (body) => keyOf(body), answer: (body) => priceOf(body) },
    giftCreate: { kind: 'commit', answer: () => ({ id: 42 }) },
  }),
  render: () => <Shell ui={<NewVoucherPage />} route="/bons-cadeaux/nouveau" path="/bons-cadeaux/nouveau" />,
  ready: () => foldOpened() && Boolean(inputOf('Temps en plus')),
  channels: [{ name: 'price', key: screenKey }],
  commitButton: submit,
  findTyped: () => [],
  liveness: (ctx) => {
    const button = submit();
    return button && button.disabled && ctx.states.price.kind === 'fresh' && !ctx.server.pending().some((r) => r.kind === 'commit')
      ? '« Créer le bon » disabled on a fresh price' : null;
  },
  snapshot: () => ({ key: screenKey() }),
  commitCheck: (_ctx, req, snap) => (keyOf(req.args[0]) !== snap.key ? [`the voucher sent ${keyOf(req.args[0])} for ${snap.key} on screen`] : []),
  afterCommitOk: async (ctx) => { ctx.done = true; },
  ops: {
    extraUp: stepperOp('Augmenter', 0),
    extraDown: stepperOp('Diminuer', 0),
    drinkUp: stepperOp('Augmenter', 1),
    drinkDown: stepperOp('Diminuer', 1),
    retry: retryOp,
    commit: { weight: 2, commit: true, run: (ctx) => press(ctx, submit()) },
    remount: remountOp(() => foldOpened() && Boolean(inputOf('Temps en plus'))),
  },
};

test('« Nouveau bon » keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([1, 2, 3]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(90000));
