/**
 * The words and states of a Mollie tranche (specs/mollie-rolling-reserve-and-incoming-payments.md rules 18-19, 23):
 * one tranche of a paid link as the payments ledger prints it, and the one-line schedule of a fiche. Pure: reconciliation
 * items in, ready-to-render lines out — the client only draws them.
 */

const { euros } = require('./receiptStates');

const frShort = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const frLong = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
// A rate is validated to two decimals at most: it prints as typed, with a decimal comma.
const percentLabel = (n) => `${String(n).replace('.', ',')} %`;

const TRANCHE_LABELS = Object.freeze({
  immediat: () => 'Versement immédiat',
  retenue: (mollie) => `Retenue Mollie ${percentLabel(mollie.ratePercent)}`,
});

const DETAIL_WORDS = {
  received: (v) => `reçu le ${frShort(v.receivedDate)}`,
  transit: (v) => `attendu vers le ${frShort(v.expectedDate)}`,
  held: (v) => `prévue vers le ${frLong(v.expectedDate)}`,
  late: (v) => `attendu depuis le ${frShort(v.expectedDate)}`,
};
const STATE_LABELS = {
  received: (v) => `reçu le ${frShort(v.receivedDate)}`,
  transit: () => 'en transit',
  held: (v) => `retenue jusqu'au ${frLong(v.expectedDate)}`,
  late: () => 'en retard',
};
const TONES = { received: 'success', transit: 'neutral', held: 'neutral', late: 'error' };

/**
 * Rule 18 — a tranche item of the reconciliation (`item.mollie` set) as one dated ledger line. States: `transit`
 * (immediate share not on the account yet), `received`, `held` (reserve), `late`.
 */
function trancheView(item) {
  const m = item.mollie;
  const last = item.bank[item.bank.length - 1] || null;
  let state;
  if (last) state = 'received';
  else if (item.state === 'late') state = 'late';
  else state = m.tranche === 'retenue' ? 'held' : 'transit';
  const view = {
    key: item.ledgerKey, tranche: m.tranche, label: m.label,
    amountCents: item.expectedCents, amount: item.expectedCents / 100,
    state, tone: TONES[state],
    expectedDate: item.expectedDate, expectedDateLabel: frLong(item.expectedDate),
    receivedDate: last ? last.date : null, receivedDateLabel: last ? frShort(last.date) : null,
  };
  const detail = DETAIL_WORDS[state](view);
  return {
    ...view,
    stateLabel: STATE_LABELS[state](view),
    text: `${m.label} · ${euros(item.expectedCents)} · ${detail}`,
    refs: last ? last.refs : null,
  };
}

/**
 * Rule 19 — what a fiche still waits for from Mollie, as the recap line of the money summary. `null` when no tranche
 * is pending: a fiche with nothing to arrive shows nothing new.
 */
function scheduleView(views) {
  if (views.length === 0) return null;
  const sum = (list) => list.reduce((t, v) => t + v.amountCents, 0);
  const received = views.filter((v) => v.state === 'received');
  const expected = views.filter((v) => v.state === 'transit' || v.state === 'held');
  const late = views.filter((v) => v.state === 'late');
  if (expected.length === 0 && late.length === 0) return null;
  const nextDate = expected.map((v) => v.expectedDate).filter(Boolean).sort()[0] || null;
  const segments = [{ text: `Payé par carte ${euros(sum(views))}`, tone: 'default' }];
  if (received.length > 0) segments.push({ text: `${euros(sum(received))} reçus`, tone: 'success' });
  if (expected.length > 0) segments.push({ text: `${euros(sum(expected))} attendus${nextDate ? ` le ${frLong(nextDate)}` : ''}`, tone: 'muted' });
  if (late.length > 0) segments.push({ text: `${euros(sum(late))} en retard`, tone: 'error' });
  const [head, ...rest] = segments;
  return {
    text: `${head.text}${rest.length > 0 ? ` — ${rest.map((s) => s.text).join(' · ')}` : ''}`,
    segments, totalCents: sum(views), receivedCents: sum(received), expectedCents: sum(expected), lateCents: sum(late),
    nextDate, nextDateLabel: frLong(nextDate),
  };
}

module.exports = { trancheView, scheduleView, TRANCHE_LABELS, percentLabel, frShort, frLong };
