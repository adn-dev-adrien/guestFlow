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

/** The reserve's share as the words print it: what was kept of the payment (`reservePercent`), else the rate asked for. */
const reserveShare = (mollie) => (mollie.reservePercent != null ? mollie.reservePercent : mollie.ratePercent);

const TRANCHE_LABELS = Object.freeze({
  immediat: () => 'Versement immédiat',
  retenue: (mollie) => `Retenue Mollie ${percentLabel(reserveShare(mollie))}`,
});

/** « Paiement carte · 80 % » — the immediate share of a payment, as a share of it (never a constant). */
const immediateShareLabel = (mollie) => `Paiement carte · ${percentLabel(mollie.immediatePercent)}`;

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
  late: (v) => `en retard de ${v.daysLate} j`,
};
const TONES = { received: 'success', transit: 'neutral', held: 'neutral', late: 'error' };

/**
 * Rule 18 — a tranche item of the reconciliation (`item.mollie` set) as one dated ledger line. States: `transit`
 * (immediate share not on the account yet), `received`, `held` (reserve), `late` (the window has passed without a
 * credit — whether or not a proposal is waiting, rule 13).
 */
function trancheView(item) {
  const m = item.mollie;
  const last = item.bank[item.bank.length - 1] || null;
  let state;
  if (last) state = 'received';
  else if (m.late) state = 'late';
  else state = m.tranche === 'retenue' ? 'held' : 'transit';
  const view = {
    key: item.ledgerKey, tranche: m.tranche, label: m.label,
    amountCents: item.expectedCents, amount: item.expectedCents / 100,
    state, tone: TONES[state], late: state === 'late', daysLate: state === 'late' ? m.daysLate : 0,
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
 * Rule 19 — what a fiche still waits for from Mollie, as the recap line of the money summary, tranche by tranche: the
 * immediate share (« attendus le 30/10 »), the reserve (« retenus jusqu'au 28/01/2027 »), and what is past its window
 * (« en retard »). `null` when no tranche is pending: a fiche with nothing to arrive shows nothing new.
 */
function scheduleView(views) {
  if (views.length === 0) return null;
  const sum = (list) => list.reduce((t, v) => t + v.amountCents, 0);
  const earliest = (list) => list.map((v) => v.expectedDate).filter(Boolean).sort()[0] || null;
  const received = views.filter((v) => v.state === 'received');
  const transit = views.filter((v) => v.state === 'transit');
  const held = views.filter((v) => v.state === 'held');
  const late = views.filter((v) => v.state === 'late');
  if (transit.length === 0 && held.length === 0 && late.length === 0) return null;
  const transitDate = earliest(transit);
  const heldUntil = earliest(held);
  const segments = [{ text: `Payé par carte ${euros(sum(views))}`, tone: 'default' }];
  if (received.length > 0) segments.push({ text: `${euros(sum(received))} reçus`, tone: 'success' });
  if (late.length > 0) segments.push({ text: `${euros(sum(late))} en retard`, tone: 'error' });
  if (transit.length > 0) segments.push({ text: `${euros(sum(transit))} attendus${transitDate ? ` le ${frShort(transitDate)}` : ''}`, tone: 'muted' });
  if (held.length > 0) segments.push({ text: `${euros(sum(held))} retenus${heldUntil ? ` jusqu'au ${frLong(heldUntil)}` : ''}`, tone: 'muted' });
  const [head, ...rest] = segments;
  const nextDate = earliest([...transit, ...held]);
  return {
    text: `${head.text}${rest.length > 0 ? ` — ${rest.map((s) => s.text).join(' · ')}` : ''}`,
    segments, totalCents: sum(views), receivedCents: sum(received), expectedCents: sum(transit) + sum(held), lateCents: sum(late),
    transitCents: sum(transit), heldCents: sum(held), transitDate, transitDateLabel: frShort(transitDate), heldUntil, heldUntilLabel: frLong(heldUntil),
    nextDate, nextDateLabel: frLong(nextDate),
  };
}

module.exports = { trancheView, scheduleView, TRANCHE_LABELS, immediateShareLabel, percentLabel, frShort, frLong };
