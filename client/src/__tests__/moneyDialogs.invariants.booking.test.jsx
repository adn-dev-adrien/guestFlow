// specs/plugins-phase-1-sdk.md rule 58 (loop t26) — the money-dialog invariants I1-I6, generated: an hourly booking
// (`ResourceBookingDialog`: its price, the invoice question of the payment typed, the save). The driver and the invariants are in
// `moneyDialogsHarness.jsx`.
import React from 'react';
import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../api';
import ResourceBookingDialog from '../plugins/hourly-resources/ResourceBookingDialog';
import {
  runFamily, formatFailures, harnessSeeds, harnessSteps, harnessTimeout, press, typeInto, findButton, actionButton, retryOp, remountOp, tenderBlocks,
  tendersOnScreen, tenderSig, fieldByLabel, focusOn, flush, centsOfInput,
} from './moneyDialogsHarness';

vi.mock('../api', async () => (await import('./moneyDialogsHarness')).apiModule());
vi.mock('../hooks/usePostalCodeCities', () => ({ default: () => [] }));
vi.mock('../hooks/usePlugins', () => ({ usePlugin: () => true, usePlugins: () => ({ plugins: [] }) }));

const RESOURCE = { id: 3, name: 'Bain fictif', isComplex: 1, priceType: 'per_hour', openTime: '08:00', closeTime: '22:00', slotDuration: 30, minimumUsageMinutes: 60 };
const BOOKING = { id: 9, date: '2099-02-13', startTime: '18:00', endTime: '20:00', clientName: 'X', notes: '', paid: false };
const minutesOf = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const draftKeyOf = (body) => JSON.stringify([body.startTime, body.endTime, Number(body.offeredMinutes) || 0]);
const paymentSig = (payment) => tenderSig(payment.tenders, payment.shortfall && payment.shortfall.kind);
function priceOf(body) {
  const minutes = minutesOf(body.endTime) - minutesOf(body.startTime);
  const billed = Math.max(0, minutes - (Number(body.offeredMinutes) || 0));
  const totalCents = Math.round((billed / 60) * 3737);
  const total = totalCents / 100;
  const out = {
    total, pricing: 'banded', rateGrid: 'external', durationMinutes: minutes, freeMinutesApplied: 0, billedMinutes: billed, grossTotal: Math.round((minutes / 60) * 3737) / 100,
    bands: [], freeValue: 0, lines: [], vat: null, invoiceReady: true,
  };
  if (body.payment) {
    const paid = body.payment.tenders.reduce((s, t) => s + t.amountCents, 0);
    out.invoiceable = body.payment.tenders.some((t) => t.internal) ? { ok: false, code: 'INTERNAL_CASH', reason: 'Caisse interne.' }
      : (paid === totalCents ? { ok: true, code: null, reason: null } : { ok: false, code: 'NOT_WHOLE', reason: 'Le paiement ne fait pas le prix.' });
  }
  return out;
}
const combo = (label) => {
  const control = [...document.querySelectorAll('[role="dialog"] .MuiFormControl-root')].find((c) => {
    const l = c.querySelector('label');
    return l && l.textContent.trim() === label;
  });
  return control ? control.querySelector('[role="combobox"]') : null;
};
function screenDraft(ctx) {
  const start = combo('Heure début');
  const end = combo('Heure fin');
  const startTime = start ? start.textContent.trim() : '';
  const endTime = end ? end.textContent.trim() : '';
  if (!/^\d\d:\d\d$/.test(startTime) || !/^\d\d:\d\d$/.test(endTime) || endTime <= startTime) return null;
  const shown = document.querySelector('[role="group"][aria-label="Temps offert"] p');
  if (shown) ctx.state.offered = Number(shown.textContent);
  return JSON.stringify([startTime, endTime, ctx.state.offered || 0]);
}
const payingNow = () => Boolean([...document.querySelectorAll('[role="dialog"] button[aria-pressed="true"]')].find((b) => b.textContent === 'Maintenant'));
function screenPayment() {
  if (!payingNow()) return null;
  const block = tenderBlocks(document.body)[0];
  return block ? tenderSig(tendersOnScreen(block), block.short ? block.shortfall : null) : null;
}
const saveButton = () => actionButton(/^Enregistrer/);
const invoiceBox = () => document.querySelector('[data-testid="invoice-block"] input[type="checkbox"]');
const ready = () => Boolean(combo('Heure fin'));
async function choose(ctx, label, value) {
  const box = combo(label);
  if (!box || box.getAttribute('aria-disabled') === 'true') return false;
  focusOn(box);
  ctx.focusedOnce = true;
  fireEvent.mouseDown(box);
  await flush();
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === value);
  if (!option || option.getAttribute('aria-disabled') === 'true') { fireEvent.keyDown(document.activeElement, { key: 'Escape' }); await flush(); return false; }
  fireEvent.click(option);
  await flush();
  return true;
}

const adapter = {
  name: 'ResourceBookingDialog',
  fixtures: [{ total: 74.74 }],
  tenders: true,
  routes: () => ({
    getOccupiedSlots: { kind: 'read', answer: () => ({ occupiedSlots: [] }) },
    getClientPicker: { kind: 'read', answer: () => ({ options: [] }) },
    getProperties: { kind: 'read', answer: () => [] },
    previewResourceBooking: {
      kind: 'preview',
      channel: (body) => (body.payment ? 'invoice' : 'price'),
      key: (body) => (body.payment ? `${draftKeyOf(body)}|${paymentSig(body.payment)}` : draftKeyOf(body)),
      answer: (body) => priceOf(body),
      silent: (body) => ({ ...priceOf(body), ...(body.payment ? { invoiceable: { ok: false, code: 'NOTHING', reason: null, silent: true } } : {}) }),
    },
    recordResourceBookingPayment: { kind: 'commit', answer: () => ({ id: 9 }) },
    issueResourceBookingInvoice: { kind: 'commit', answer: () => ({ id: 9 }) },
  }),
  render: (ctx) => (
    <ResourceBookingDialog
      open resource={RESOURCE} booking={BOOKING}
      onClose={() => { ctx.closed = true; }}
      onSave={(data, id) => ctx.server.prop('onSave', [data, id], { id: 9 }, null)}
      onDelete={() => {}} onCommitted={() => {}}
    />
  ),
  ready,
  setup: (ctx) => { ctx.state.offered = 0; },
  onRemount: (ctx) => { ctx.state.offered = 0; },
  channels: [
    { name: 'price', key: screenDraft, failureWords: (req) => [req.message, /Prix indisponible/] },
    {
      name: 'invoice',
      // Asked once the price on screen is answered: before that the question waits, pending.
      key: (ctx) => {
        const pay = screenPayment();
        const draft = screenDraft(ctx);
        if (!pay || !draft || ctx.channelState(adapter.channels[0], draft).kind !== 'fresh') return null;
        return `${draft}|${pay}`;
      },
      failureWords: (req) => [req.message, /Facture non vérifiée|Vérification de la facture/],
    },
  ],
  commitButton: saveButton,
  requirements: () => {
    const name = fieldByLabel('Nom du client *');
    return name && !name.value.trim() ? ['no client name'] : [];
  },
  dueOf: (ctx) => {
    const state = ctx.states.price;
    const dues = [];
    if (state.kind === 'fresh') dues.push(Math.round(state.req.answer.total * 100));
    if (state.kind === 'pending' && ctx.server.accepted.price) dues.push(Math.round(ctx.server.accepted.price.answer.total * 100));
    return dues;
  },
  liveness: (ctx, blocks) => {
    const save = saveButton();
    const price = ctx.states.price;
    const invoice = ctx.states.invoice;
    if (!save || !save.disabled || price.kind !== 'fresh' || !['idle', 'fresh'].includes(invoice.kind)) return null;
    if (adapter.requirements(ctx).length) return null;
    const b = blocks[0];
    if (payingNow() && (!b || !b.covered || b.lines.some((l) => !(centsOfInput(l.value) > 0)))) return null;
    return `« ${save.textContent.trim()} » disabled on a fresh price with the payment covering it`;
  },
  findTyped: (_ctx, ident) => { const el = fieldByLabel(ident); return el ? [el] : []; },
  findTick: () => invoiceBox(),
  // « Créer la facture dans Qonto » follows the card by default (ticked for a card line): a gesture on the lines may set it again.
  onTenderGesture: (ctx) => { ctx.tickSnap.clear(); },
  snapshot: (ctx) => ({ draft: screenDraft(ctx), payment: screenPayment(), tick: invoiceBox() ? invoiceBox().checked : null }),
  commitCheck: (ctx, req, snap) => {
    const out = [];
    if (req.name === 'onSave') {
      const [data] = req.args;
      const sent = draftKeyOf(data);
      if (sent !== snap.draft) out.push(`the save sent ${sent} for ${snap.draft} on screen`);
      const fresh = (req.freshAtClick || {}).price;
      if (!fresh || fresh.state !== 'ok' || data.displayedTotal !== fresh.answer.total) out.push(`the save showed ${data.displayedTotal} without a fresh price for it`);
      ctx.state.savedSnap = snap;
    }
    if (req.name === 'recordResourceBookingPayment') {
      const sent = paymentSig(req.args[1]);
      const shown = (ctx.state.savedSnap || {}).payment;
      if (sent !== shown) out.push(`the payment sent ${sent} for ${shown} on screen`);
    }
    return out;
  },
  ops: {
    offeredTime: {
      weight: 2,
      gen: (rnd) => ({ more: rnd.next() < 0.6 }),
      async run(ctx, { more }) {
        const ok = await press(ctx, findButton(ctx, more ? 'Plus 15 minutes' : 'Moins 15 minutes'));
        return ok;
      },
    },
    endTime: {
      weight: 2,
      gen: (rnd) => ({ value: rnd.pick(['19:00', '19:30', '20:00', '21:00']) }),
      run: (ctx, { value }) => choose(ctx, 'Heure fin', value),
    },
    payWhen: {
      weight: 2,
      gen: (rnd) => ({ now: rnd.next() < 0.7 }),
      async run(ctx, { now }) {
        ctx.tenderSnap = null; ctx.shortSnap = null; ctx.tickSnap.clear();
        return press(ctx, [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === (now ? 'Maintenant' : 'À l\'arrivée')));
      },
    },
    clientName: {
      weight: 1,
      gen: (rnd) => ({ value: rnd.pick(['', 'Lou', 'X']) }),
      run: (ctx, { value }) => typeInto(ctx, fieldByLabel('Nom du client *'), value, 'Nom du client *'),
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
    commit: { weight: 2, commit: true, applicable: () => Boolean(saveButton()), run: (ctx) => press(ctx, saveButton()) },
    remount: remountOp(ready),
  },
};

// Seeds found by the long run (loop t26, 2026-11-19): a draft back to its answered value asked the invoice question / showed a save over a
// re-ask in flight; fixed in useLatestPreview (no re-ask of a draft already asked or answered).
test('an hourly booking keeps the money-dialog invariants on every generated seed', async () => {
  const failures = await runFamily(adapter, api, { seeds: harnessSeeds([[263, 60], [275, 60], [307, 60], [738, 60], [841, 60], [1312, 60], [1592, 60], [1706, 60], [944, 60]]), steps: harnessSteps(30) });
  expect(formatFailures(failures)).toBe('');
}, harnessTimeout(90000));
