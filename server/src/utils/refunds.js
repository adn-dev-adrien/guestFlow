/**
 * Remboursements — specs/reservation-refunds.md.
 *
 * A refund is an « avoir »: money returned to the guest AFTER the sale, with its own date, WITHOUT
 * touching the sale. The sale keeps its price, its échéances and its paid flags; the refund lives in
 * its own register and is subtracted downstream (fiche total, finance aggregates, CA) and mirrored
 * as a reversed journal entry in the monthly export.
 *
 * Everything here is pure (no DB, no clock — `today` is injected): the caps, the refundable-line
 * derivation and the HT/VAT split are unit-testable in isolation. Persistence belongs to
 * models/refundsModel.js, orchestration to controllers/refundsController.js.
 */

const { extraLineKey, parseDetail, parseNotes, settledByKey } = require('./midStayExtras');
const { parseRemovedLineContribs } = require('./removedLineContribs');
const { readComplementPaidSplit } = require('./complementPaidSplit');
const { isRealIsoDay, dateWindowMessage } = require('./stayDates');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Means of refund. `transfer` + `cash` are book money; `internal` (caisse interne) stays off the
// books, exactly like the cash complements (specs/cash-complement-and-endofstay-finance.md).
// `retained` is book money too, but no money moves: it is the requalification avoir written when a
// stay is cancelled for non-payment and the acompte is kept as an indemnity
// (specs/payment-schedule-and-cancellation.md §3.6 rule 32). It is never operator-selectable — only
// the cancellation flow writes it — so it stays out of `SELECTABLE_REFUND_METHODS`.
const REFUND_METHODS = ['transfer', 'cash', 'internal', 'retained'];
const SELECTABLE_REFUND_METHODS = ['transfer', 'cash', 'internal'];
const RETAINED_DEPOSIT_METHOD = 'retained';
const OFF_BOOKS_METHOD = 'internal';

// Revenue/pass-through buckets a refund line can land in. Mirrors the accounting buckets, plus the
// tourist tax which is a pass-through (no VAT, no revenue account).
const REFUND_BUCKETS = ['accommodation', 'options', 'resources', 'touristTax'];

// On a cancelled stay, the share of a manual refund the indemnity pays (specs/reservation-refunds.md rule 48): no
// revenue, no VAT — the export debits the indemnity account the cancellation credited. Never operator-selectable.
const INDEMNITY_BUCKET = 'indemnity';

// The cents a stored-money split can leave between a line's billed amount and what its bucket booked (two entries,
// each rounded per bucket, the accounting export's CONTRIB_RESIDUE_TOLERANCE_TTC).
const STORED_SPLIT_ROUNDING_TTC = 0.02;

const ACCOMMODATION_KEY = 'accommodation';
const TOURIST_TAX_KEY = 'touristTax';
// The key of a requalification line that reverses a commission the payment provider withheld on a paid acompte or
// solde (payment-schedule-and-cancellation rule 55 reading of 2026-11-02): it names no billed line.
const COMMISSION_KEY = 'commission';

const ACCOMMODATION_LABEL = 'Hébergement';
const TOURIST_TAX_LABEL = 'Taxe de séjour';
// Rule 49 reading of 2026-11-05 (audit R23 N5) — what a plan's paid installments booked per bucket beyond the lines still
// naming it. An installment's split knows the bucket, not the line.
const PLAN_BUCKET_LINES = [
  { bucket: 'options', key: 'plan:options', label: 'Prestations encaissées' },
  { bucket: 'resources', key: 'plan:resources', label: 'Activités encaissées' },
];
const bucketOfKey = (key) => (String(key).startsWith('res:') ? 'resources' : 'options');

function isOffBooks(method) {
  return String(method) === OFF_BOOKS_METHOD;
}

// A `retained` avoir reverses revenue in the JOURNAL, but no money ever left our account: the acompte
// stayed, requalified as an indemnity (specs/payment-schedule-and-cancellation.md §3.6). So every
// reader that answers « how much did we give back to this guest » must skip it — otherwise a cancelled
// stay reads as a refund on the fiche and in the finance aggregates, which is the exact opposite of
// what happened. The monthly journal read (`listByMonth`) deliberately keeps it.
function isRetainedDeposit(method) {
  return String(method) === RETAINED_DEPOSIT_METHOD;
}

/**
 * Stable key of a billed line, shared with the mid-stay register so the two features never disagree
 * on line identity (`opt:<id>` / `res:<id>` / `custom:<label>`).
 */
function billedLineKey(line) {
  return extraLineKey(line);
}

function lineLabelOf(line) {
  return String(line.title || line.name || line.description || 'Prestation').trim() || 'Prestation';
}

/**
 * `{ key → TTC already refunded }` over a reservation's whole refund register (every means). `filter`
 * keeps only some refunds — `isRequalification` for the money a cancellation requalified.
 */
function refundedByKey(refunds, filter = () => true, lineFilter = () => true) {
  const byKey = {};
  for (const refund of (refunds || []).filter(filter)) {
    for (const line of refund.lines || []) {
      if (!line.lineKey || !lineFilter(line)) continue;
      byKey[line.lineKey] = round2((byKey[line.lineKey] || 0) + Number(line.amountTtc || 0));
    }
  }
  return byKey;
}

// A `retained` avoir gives nothing back: it requalifies money a cancellation kept as an indemnity
// (payment-schedule spec §3.6).
const isRequalification = (refund) => String((refund && refund.method) || '') === 'retained';

const isIndemnityLine = (line) => String((line && line.bucket) || '') === INDEMNITY_BUCKET;

// A requalification line reversing a commission the payment provider withheld (rule 55 reading of 2026-11-02).
const isCommissionLine = (line) => Boolean(line) && line.lineKey === COMMISSION_KEY;

/**
 * specs/payment-schedule-and-cancellation.md rule 55 reading of 2026-11-02 (second review of PR #926) — a book refund
 * that existed when the cancellation wrote its `retained` avoir: the avoir was netted of it, so deleting it would turn
 * its money back into sale money the stay never holds. The avoir is written after it, so its id is higher.
 * Reading of 2026-11-02 (audit R16-L1) — only when it moved the avoir: `nettedIds` (cancelReservation's
 * `cancellationNettedRefundIds`) names the refunds whose removal changes what the avoir keeps. A refund the paid solde
 * absorbed whole is not among them. Without that set, every refund before the avoir counts.
 */
function nettedByCancellation(refund, refunds, nettedIds = null) {
  if (!refund || isOffBooks(refund.method) || isRetainedDeposit(refund.method)) return false;
  if (!writtenBeforeAvoir(refunds)(refund)) return false;
  return !nettedIds || refund.id == null || nettedIds.has(Number(refund.id));
}

/**
 * specs/reservation-refunds.md rule 6 reading of 2026-11-02 (audit R15-C1) — a refund made after the stay was
 * cancelled: the cancellation never read it, so deleting it gives its money back to the budget it came from. With an
 * avoir, after it (a higher id); without one, what the refund recorded when it was written (`afterCancellation`,
 * review of PR #929: the order, which the second-resolution clock cannot tell within one second), or — for a refund
 * recorded before that flag existed — a `createdAt` later than the stay's `cancelledAt`. Unknown → not after.
 */
function madeAfterCancellation(refund, refunds, cancelledAt) {
  if (!refund || isRetainedDeposit(refund.method)) return false;
  const list = refunds || [];
  if (list.some(isRequalification)) return !writtenBeforeAvoir(list)(refund);
  if (refund.afterCancellation != null) return Number(refund.afterCancellation) === 1;
  const created = String(refund.createdAt || '');
  const at = String(cancelledAt || '');
  return Boolean(created && at) && created > at;
}

/**
 * Payment-schedule rule 55 reading of 2026-11-02 (review of PR #929, F2) — whether the cancellation had book money to
 * keep: a paid acompte or paid installments, or a commission withheld on a paid solde. A stay paid in full with no
 * commission had none: its cancellation read no refund, whatever was given back before it.
 */
function cancellationHadBookMoney(row) {
  const book = (paid, cash) => Number(row[paid]) === 1 && !Number(row[cash] || 0);
  return (book('depositPaid', 'depositPaidCash') && round2(row.depositAmount) > 0)
    || round2(row.installmentsPaidAmount) > 0
    || (book('balancePaid', 'balancePaidCash') && round2(row.platformCommissionAmount) > 0);
}

const DELETION_REFUSALS = {
  retained: { code: 'REFUND_RETAINED_AVOIR', error: 'L’indemnité d’annulation ne se supprime pas.' },
  netted: { code: 'REFUND_NETTED_BY_CANCELLATION', error: 'Remboursement déduit de l’acompte conservé.' },
  before: { code: 'REFUND_BEFORE_CANCELLATION', error: 'Remboursement antérieur à l’annulation.' },
  keptSum: { code: 'REFUND_NETTED_BY_CANCELLATION', error: 'Remboursement déduit de la somme conservée.' },
};

/**
 * Why a refund of the register cannot be deleted, or null (rule 6 reading of 2026-11-02): the `retained` avoir is the
 * cancellation itself; on a cancelled stay a book refund made before the cancellation was read by it (netted from the
 * avoir, or the reason it kept nothing). A caisse-interne refund is off the books: the cancellation never read it. A
 * cancellation that had no book money to keep read no refund either (review of PR #929, F2). Shared by the DELETE
 * route and the ledger, so the fiche offers exactly what the server accepts.
 * Payment-schedule rule 55 reading of 2026-11-02 (audit R16-L1) — with an avoir and its `nettedIds`, a book refund
 * before it that the avoir never read (the paid solde absorbed it whole) is deleted: its money goes back to the solde.
 */
function caisseKeptMoves(refund, refunds, row) {
  const { cashDepositKeptOf } = require('./cancelReservation');
  const before = (refunds || []).filter((r) => !madeAfterCancellation(r, refunds, row.cancelledAt));
  const without = before.filter((r) => r !== refund && !(r.id != null && refund.id != null && Number(r.id) === Number(refund.id)));
  return cashDepositKeptOf(row, without) !== cashDepositKeptOf(row, before);
}

function refundDeletionRefusal(refund, refunds, reservation, nettedIds = null) {
  if (!refund) return null;
  if (isRetainedDeposit(refund.method)) return DELETION_REFUSALS.retained;
  const row = reservation || {};
  if (String(row.kind) !== 'cancelled') return null;
  if (nettedByCancellation(refund, refunds, nettedIds)) return DELETION_REFUSALS.netted;
  // Payment-schedule rule 62 reading (verification R44b N1) — since rule 61 the sum kept reads the caisse acompte net of
  // the caisse refunds made before the cancel: deleting one of those would raise a sum the notice already stated.
  if (isOffBooks(refund.method) && !madeAfterCancellation(refund, refunds, row.cancelledAt)
    && caisseKeptMoves(refund, refunds, row)) return DELETION_REFUSALS.keptSum;
  if (isOffBooks(refund.method) || madeAfterCancellation(refund, refunds, row.cancelledAt)) return null;
  if (nettedIds && (refunds || []).some(isRequalification)) return null;
  return cancellationHadBookMoney(row) ? DELETION_REFUSALS.before : null;
}

// Whether a refund of the register was written before its (last) `retained` avoir: a lower id, or — for a register
// handed without ids, by a pure caller — an earlier place in the list.
function writtenBeforeAvoir(refunds) {
  const list = refunds || [];
  const avoirs = list.map((refund, index) => ({ refund, index })).filter(({ refund }) => isRequalification(refund));
  if (avoirs.length === 0) return () => false;
  const hasId = (refund) => refund && refund.id != null && Number.isFinite(Number(refund.id));
  const last = avoirs.reduce((best, entry) => (hasId(entry.refund) && hasId(best.refund)
    ? (Number(entry.refund.id) > Number(best.refund.id) ? entry : best) : entry));
  return (refund) => {
    if (!refund || refund === last.refund) return false;
    if (hasId(refund) && hasId(last.refund)) return Number(refund.id) < Number(last.refund.id);
    const index = list.indexOf(refund);
    return index >= 0 && index < last.index;
  };
}

/**
 * What a cancelled stay can still give back (specs/reservation-refunds.md rule 48). `collectedTtc` is the book
 * money it collected, net of every book refund (`comptaCollected`). Of the rest, `indemnityLeftTtc` is what the
 * cancellation requalified and no refund has taken from the indemnity yet; `saleLeftTtc` is the remainder — a paid
 * solde, say — which a refund still reverses as revenue + VAT.
 *
 * Rule 48 reading of 2026-11-02 (audit R15-L1) — the caisse interne has a budget of its own: `cashCollectedTtc`
 * (`cashCollected`) less what it gave back, `cashLeftTtc`, refundable in the caisse interne only. A caisse-interne
 * refund beyond that money gave back book money, which comes off `collectedTtc`.
 * Rule 48 reading of 2026-11-02 (review of PR #926, residual A) — the commissions an avoir requalified (lines keyed
 * `commission`) were withheld by the payment provider, never collected: the indemnity never gives them back.
 */
function cancelledRefundBudget({ collectedTtc, cashCollectedTtc = 0, refunds = [] }) {
  const givenInCash = (refunds || []).filter((r) => isOffBooks(r.method))
    .flatMap((r) => r.lines || []).filter((l) => !isIndemnityLine(l))
    .reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const cash = Math.max(0, round2(cashCollectedTtc));
  const collected = Math.max(0, round2(Number(collectedTtc || 0) - Math.max(0, round2(givenInCash - cash))));
  const requalified = (refunds || []).filter(isRequalification).reduce((sum, r) => sum + Number(r.totalTtc || 0), 0);
  const withheld = (refunds || []).filter(isRequalification).flatMap((r) => r.lines || [])
    .filter((l) => l.lineKey === COMMISSION_KEY).reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const fromIndemnity = (refunds || []).filter((r) => !isRequalification(r))
    .flatMap((r) => r.lines || []).filter(isIndemnityLine)
    .reduce((sum, l) => sum + Number(l.amountTtc || 0), 0);
  const indemnityLeftTtc = Math.min(collected, Math.max(0, round2(requalified - withheld - fromIndemnity)));
  return {
    collectedTtc: collected,
    indemnityLeftTtc,
    saleLeftTtc: round2(collected - indemnityLeftTtc),
    cashCollectedTtc: cash,
    cashLeftTtc: Math.max(0, round2(cash - givenInCash)),
  };
}

/** Σ of the refund register, either book-money only (default) or including the caisse interne. */
function refundsTotal(refunds, { withCash = false } = {}) {
  return round2((refunds || [])
    .filter((r) => withCash || !isOffBooks(r.method))
    .reduce((sum, r) => sum + Number(r.totalTtc || 0), 0));
}

/**
 * The lines a reservation can still be refunded on (spec §3.2 rules 7–8).
 *
 * Accommodation is derived the way the accounting model derives it (finalPrice minus the persisted
 * extra lines) so the refundable amounts always match what the journal actually credited. Offered
 * lines are stored at 0 € — there is nothing to give back, so they never appear.
 *
 * @param {object} input
 * @param {number} input.finalPrice     reservation TTC (stay + extras, tax excluded)
 * @param {number} input.touristTaxTotal
 * @param {number} input.vatRate        app-wide sales VAT rate (specs/single-vat-rate.md)
 * @param {Array}  input.options        option + custom-option lines (getByIdWithDetails shape)
 * @param {Array}  input.resources      resource lines
 * @param {Array}  input.refunds        the refund register (header + lines)
 * @param {number} input.nights         nights of the stay — makes the tourist-tax line refundable
 *                                      PER NIGHT (specs/reservation-refunds.md §3.5 rule 27)
 * @param {object} [input.cancelled]    `cancelledRefundBudget` of a cancelled stay: each line then offers what it
 *                                      collected (rule 48) and carries `indemnityTtc`, the part the indemnity holds
 * @param {object} [input.collected]    `collectedByLine(...)` — on a cancelled stay, each line offers at most what IT
 *                                      collected (rule 49 reading of 2026-11-02)
 * @param {boolean} [input.complementCollected] the arrival complement is paid: its lines did collect their money
 * @param {Array}  [input.goneLines]    `collectedLinesGone(...)` — on a cancelled stay, the lines that collected money
 *                                      and left the fiche since (rule 49 reading of 2026-11-05)
 * @param {object} [input.cashCollected] `collectedByLine({ cash: true })` — the same, for the caisse interne: a line
 *                                      then also offers `cashTtc`, refundable in the caisse interne only (rule 48
 *                                      reading of 2026-11-02, audit R15-L1)
 * @param {object} [input.planBuckets]  on a live stay, `bookedStayBuckets().installments`: what the lines no reading names
 *                                      share (rule 51)
 * @param {object} [input.reservation]  on a live stay, the row, for the money it collected after arrival (rule 51)
 */
function buildRefundableLines({ finalPrice, touristTaxTotal, vatRate, options = [], resources = [], refunds = [], nights = 0, cancelled = null, collected = null, cashCollected = null, complementCollected = false, goneLines = [], planBuckets = null, reservation = null }) {
  const given = refundedByKey(refunds, (refund) => !isRequalification(refund));
  const fromIndemnity = refundedByKey(refunds, (refund) => !isRequalification(refund), isIndemnityLine);
  const requalified = refundedByKey(refunds, isRequalification, (line) => !isCommissionLine(line));
  // Rule 48 reading of 2026-11-02 (review of PR #926, residual A) — the commissions an avoir requalified, per bucket:
  // they leave their lines like the acompte did, but the indemnity never gives them back.
  const withheld = {};
  for (const line of (refunds || []).filter(isRequalification).flatMap((refund) => refund.lines || []).filter(isCommissionLine)) {
    withheld[line.bucket] = round2((withheld[line.bucket] || 0) + Number(line.amountTtc || 0));
  }
  const rate = Number(vatRate || 0);

  const extras = [];
  for (const line of [...options, ...resources]) {
    if (!line || Number(line.offered || 0) === 1) continue;
    const key = billedLineKey(line);
    if (!key) continue;
    const billedTtc = round2(line.totalPrice);
    if (billedTtc <= 0) continue;
    const quantity = Number(line.billedUnits || line.quantity || 0) || null;
    extras.push({
      key,
      label: lineLabelOf(line),
      bucket: key.startsWith('res:') ? 'resources' : 'options',
      quantity,
      unitPrice: quantity ? round2(billedTtc / quantity) : null,
      billedTtc,
      vatRate: rate,
    });
  }

  const extrasTtc = round2([...options, ...resources]
    .reduce((sum, line) => sum + Number((line && line.totalPrice) || 0), 0));
  const accommodationTtc = Math.max(0, round2(Number(finalPrice || 0) - extrasTtc));

  const all = [];
  if (accommodationTtc > 0) {
    all.push({
      key: ACCOMMODATION_KEY,
      label: ACCOMMODATION_LABEL,
      bucket: 'accommodation',
      quantity: null,
      unitPrice: null,
      billedTtc: accommodationTtc,
      vatRate: rate,
    });
  }
  all.push(...extras);
  // Rule 49 reading of 2026-11-05 (D11) — a paid line removed since is offered back on what it collected, under its name.
  if (cancelled) {
    for (const line of goneLines) {
      if (all.some((other) => other.key === line.key)) continue;
      all.push({ key: line.key, label: line.label, bucket: line.bucket, quantity: null, unitPrice: null, billedTtc: line.collectedTtc, vatRate: rate });
    }
  }
  const taxTtc = round2(touristTaxTotal);
  if (taxTtc > 0) {
    // The tax is refunded BY NIGHT, never as a loose amount: the commune declaration removes whole
    // nights, so the unit the operator picks has to be the night itself (spec §3.5 rule 27). The unit
    // price is the whole party's tax for one night.
    const taxNights = Math.max(0, Math.round(Number(nights) || 0));
    all.push({
      key: TOURIST_TAX_KEY,
      label: TOURIST_TAX_LABEL,
      bucket: 'touristTax',
      quantity: taxNights || null,
      unitPrice: taxNights > 0 ? round2(taxTtc / taxNights) : null,
      unitLabel: taxNights > 0 ? 'nuit' : null,
      billedTtc: taxTtc,
      vatRate: 0, // a pass-through bears no VAT
    });
  }

  // A line whose billed amount shrank below what was already refunded clamps to 0 (spec §3.2 edge
  // case): the money physically left, but nothing more can be given back on that key. What a
  // cancellation requalified is told apart from what went back to the guest (rule 46).
  // What a refund took from the indemnity (rule 48) gave back requalified money, not the line's sale.
  const perLine = all.map((line) => {
    const refundedTtc = round2(given[line.key] || 0);
    const withheldTtc = line.key === ACCOMMODATION_KEY ? round2(withheld.accommodation || 0) : 0;
    const requalifiedTtc = round2((requalified[line.key] || 0) + withheldTtc);
    const saleRefundedTtc = round2(refundedTtc - (fromIndemnity[line.key] || 0));
    // Rule 49 reading of 2026-11-05 (audit R22-4) — a line lowered after it was paid still holds what it collected.
    const ceilingTtc = cancelled && collected && line.key in collected ? Math.max(line.billedTtc, Number(collected[line.key]) || 0) : line.billedTtc;
    return { ...line, ceilingTtc, refundedTtc, requalifiedTtc, withheldTtc, refundableTtc: Math.max(0, round2(ceilingTtc - saleRefundedTtc - requalifiedTtc)) };
  });
  // Rule 48 reading of 2026-11-02 (audit R15-L1) — what the caisse interne collected on a line (0 when it collected
  // nothing on the stay, unknown on a line no reading names) and gave back there: beyond that money, a caisse-interne
  // refund gave back the line's book money.
  const inCash = refundedByKey(refunds, (refund) => isOffBooks(refund.method));
  const hasCash = Boolean(cancelled) && Number(cancelled.cashCollectedTtc || 0) > 0;
  const cashOf = (line) => (!hasCash ? 0 : (cashCollected && line.key in cashCollected ? cashCollected[line.key] : Infinity));
  const cashLeftOf = (line) => Math.max(0, cashOf(line) - (inCash[line.key] || 0));
  const bookGivenOf = (line) => round2(line.refundedTtc - (fromIndemnity[line.key] || 0) - (inCash[line.key] || 0)
    + (cashOf(line) === Infinity ? 0 : Math.max(0, (inCash[line.key] || 0) - cashOf(line))));
  // Rule 49 reading of 2026-11-02 — on a cancelled stay a line never holds more than it collected, net of the sale
  // money already given back on it: a line paid at arrival and never collected requalifies nothing and offers nothing.
  const collectedLeft = (line) => (cancelled && collected && line.key in collected
    ? Math.max(0, round2(collected[line.key] - bookGivenOf(line))) : Infinity);
  // Rule 49 reading of 2026-11-02 (second review of PR #926) — the avoir is spread over the lines as they stood when
  // it was written: a refund made after it never moves its money from one line to another, so giving back one line
  // leaves what the others offer unchanged.
  const beforeAvoir = writtenBeforeAvoir(refunds);
  const saleBefore = refundedByKey(refunds, (refund) => !isRequalification(refund) && beforeAvoir(refund), (line) => !isIndemnityLine(line));
  const roomAtAvoir = (line) => {
    const before = saleBefore[line.key] || 0;
    const billed = Math.max(0, round2(line.ceilingTtc - before - line.requalifiedTtc));
    return cancelled && collected && line.key in collected ? Math.min(billed, Math.max(0, round2(collected[line.key] - before))) : billed;
  };
  ['options', 'resources'].forEach((bucket) => spreadBucketRefund(perLine.filter((line) => line.key !== bucket && line.bucket === bucket), requalified[bucket], roomAtAvoir));
  ['options', 'resources'].forEach((bucket) => spreadBucketRefund(perLine.filter((line) => line.key !== bucket && line.bucket === bucket), withheld[bucket], roomAtAvoir, true));
  if (cancelled) {
    // Rule 48 — a cancelled stay gives back money it collected, never what it billed: the requalified money the
    // indemnity still holds on the line, plus at most the collected money no cancellation requalified.
    const saleRooms = perLine.map((line) => Math.round(Math.min(line.refundableTtc, cancelled.saleLeftTtc,
      Math.max(0, collectedLeft(line) - line.requalifiedTtc)) * 100));
    const indemnityRooms = perLine.map((line) => Math.round(Math.min(cancelled.indemnityLeftTtc,
      Math.max(0, round2(line.requalifiedTtc - line.withheldTtc - (fromIndemnity[line.key] || 0)))) * 100));
    // Rule 49 — the lines together never offer more than is left: a free line took its money from no line in
    // particular, and a paid solde is one sum the lines share. The excess comes off the lines paid at arrival first,
    // the money a cancelled stay is the least likely to have collected, then off the lines whose own collection is
    // unknown, the lines capped at what they collected last.
    const atArrival = new Set([...options, ...resources].filter((line) => line && Number(line.inComplement || 0) === 1).map(billedLineKey));
    // Reading of 2026-11-05 (audit R22-2) — the arrival rank holds while the complement is unpaid: once paid, those lines
    // are the very lines that collected.
    const rank = (line) => (atArrival.has(line.key) && !complementCollected ? 0 : (collectedLeft(line) === Infinity ? 1 : 2));
    const order = perLine.map((line, index) => index).sort((a, b) => rank(perLine[a]) - rank(perLine[b]) || a - b);
    capInOrder(saleRooms, Math.round(cancelled.saleLeftTtc * 100), order);
    capInOrder(indemnityRooms, Math.round(cancelled.indemnityLeftTtc * 100), order);
    // Rule 49 reading of 2026-11-02 (second review of PR #926) — the cents the per-line caps leave unoffered (the
    // roundings of a stored-money split: a bucket booked a cent above what it billed, another a cent below) are
    // offered on the line with the most room left within what it billed, so giving everything back leaves nothing.
    let unoffered = Math.round(cancelled.saleLeftTtc * 100) - saleRooms.reduce((total, cents) => total + cents, 0);
    if (unoffered > 0 && unoffered <= Math.round(STORED_SPLIT_ROUNDING_TTC * 100)) {
      const headroom = perLine.map((line, index) => Math.round(Math.min(line.refundableTtc, cancelled.saleLeftTtc) * 100) - saleRooms[index]);
      const ranked = perLine.map((line, index) => index).sort((a, b) => headroom[b] - headroom[a] || a - b);
      for (const index of ranked) {
        const added = Math.min(unoffered, Math.max(0, headroom[index]));
        saleRooms[index] += added;
        unoffered -= added;
      }
    }
    // Rule 48 reading of 2026-11-02 (audit R15-L1) — the caisse interne's own money, within what the line billed.
    const cashRooms = perLine.map((line, index) => Math.max(0, Math.round(Math.min(
      Math.round(line.refundableTtc * 100) - saleRooms[index], cashLeftOf(line) * 100, Number(cancelled.cashLeftTtc || 0) * 100,
    ))));
    capInOrder(cashRooms, Math.round(Number(cancelled.cashLeftTtc || 0) * 100), order);
    perLine.forEach((line, index) => {
      line.indemnityTtc = indemnityRooms[index] / 100;
      if (cashRooms[index] > 0) line.cashTtc = cashRooms[index] / 100;
      line.refundableTtc = (saleRooms[index] + indemnityRooms[index] + cashRooms[index]) / 100;
    });
  } else if (collected) {
    applyLiveCollected(perLine, { collected, refunds, planBuckets, reservation });
  }
  return perLine.filter((line) => line.refundableTtc > 0).map(({ withheldTtc, ceilingTtc, ...line }) => line);
}

/**
 * Rule 51 (D15) — on a live stay each line says what a book refund can still take on it: `availableTtc`, the figure the
 * dialog blocks on. A line a reading names is capped by what it collected, net of the book refunds already made on it. A
 * plan's installments know the bucket, not the line: the lines no reading names share the bucket (`sharedBucket`). Other
 * lines no reading names (money no contrib describes) carry no figure: the total alone judges them.
 */
function applyLiveCollected(perLine, { collected, refunds, planBuckets, reservation }) {
  const given = refundedByKey(refunds, (refund) => !isOffBooks(refund.method) && !isRetainedDeposit(refund.method));
  const shared = {};
  if (planBuckets) {
    const unnamed = perLine.filter((line) => !(line.key in collected));
    const late = reservation ? collectedAfterArrival(reservation) : new Map();
    for (const { bucket } of PLAN_BUCKET_LINES) {
      const inBucket = unnamed.filter((line) => line.bucket === bucket);
      shared[bucket] = Math.max(0, round2(inBucket.reduce((sum, line) => sum + (late.has(line.key) ? late.get(line.key).amount : 0) - (given[line.key] || 0), Number(planBuckets[bucket]) || 0)));
    }
  }
  for (const line of perLine) {
    if (line.key in collected) {
      line.availableTtc = Math.min(line.refundableTtc, Math.max(0, round2(collected[line.key] - (given[line.key] || 0))));
    } else if (planBuckets && line.bucket in shared) {
      line.availableTtc = Math.min(line.refundableTtc, shared[line.bucket]);
      line.sharedBucketTtc = shared[line.bucket];
    }
  }
}

// specs/reservation-refunds.md rule 49 — lowers the rooms (cents) until they add up to `budget` at most, taking the
// excess off the lines in `order` (accommodation, the extras, the tourist tax, unless rule 49's reading ranks them).
function capInOrder(rooms, budget, order) {
  let excess = rooms.reduce((total, cents) => total + cents, 0) - Math.max(0, budget);
  for (const index of order) {
    if (excess <= 0) break;
    const taken = Math.min(excess, rooms[index]);
    rooms[index] -= taken;
    excess -= taken;
  }
}

/**
 * specs/reservation-refunds.md rule 49 reading of 2026-11-02 — what each line of a stay collected, TTC, keyed like
 * `buildRefundableLines`: the paid acompte's and solde's contribs, plus a paid arrival complement's share (the lines
 * it collects whole, and the growth of the others). The tax share an older acompte captured was booked on its
 * accommodation, and moves to the tax with the solde (accountingModel's reclass). Without contribs that add up to
 * each paid entry, the accommodation and the tax read `booked` and the extras only the lines paid at arrival (0 while
 * the complement is unpaid); `null` when nothing is known: the lines then share the money with no per-line cap.
 * Book money by default; `cash` reads the entries collected in the caisse interne instead (audit R15-L1).
 * Reading of 2026-11-05 (audit R23 N6) — on the books, a paid end-of-stay complement and the notes held their lines too
 * (`collectedAfterArrival`). The caisse interne's stays on no line (review of PR #929, F4).
 */
function collectedByLine({ reservation, options = [], resources = [], booked = null, cash = false, taxOnArrival = true, splitShares = null }) {
  const row = reservation || {};
  const billed = [...options, ...resources].filter((line) => line && Number(line.offered || 0) !== 1);
  const nz = (value) => (value == null ? 0 : Number(value));
  // Rule 48 reading of 2026-11-02 (audit R15-L1) — the book money, or (`cash`) what the caisse interne collected.
  const paid = (flag, cashFlag) => Number(row[flag]) === 1 && (Number(row[cashFlag] || 0) === 1) === Boolean(cash);
  // specs/mixed-method-payments.md rule 46 — a bucket paid with several methods, partly on the books: each reading
  // holds its share of it (`paymentTenders.bucketSharesOf`), never the whole bucket.
  const shareOf = (bucket, flag, cashFlag) => {
    const split = splitShares && splitShares[bucket];
    if (split && Number(row[flag]) === 1 && !Number(row[cashFlag] || 0)) return cash ? split.internal : split.books;
    return paid(flag, cashFlag) ? 1 : 0;
  };
  const depositShare = shareOf('deposit', 'depositPaid', 'depositPaidCash');
  const balanceShare = shareOf('balance', 'balancePaid', 'balancePaidCash');
  const complementShare = shareOf('complement', 'complementPaid', 'complementPaidCash');
  const deposit = depositShare > 0;
  const balance = balanceShare > 0;
  const complement = complementShare > 0;
  // Rule 49 reading of 2026-11-05 (D11) — a paid line since removed still holds what its entries booked.
  const removed = parseRemovedLineContribs(row.removedLineContribs).map((entry) => ({ ...entry, removed: true, totalPrice: 0, isCustom: false }));
  const lines = [...billed, ...removed];
  const keyOf = (line) => (line.removed ? line.key : billedLineKey(line));
  const late = cash ? new Map() : collectedAfterArrival(row, splitShares);
  const lateOf = (key) => (late.has(key) ? late.get(key).amount : 0);
  // Rule 49 reading of 2026-11-05 (audit R22-6a) — what the complement was stamped with at its flip is what it collected.
  const split = complement ? readComplementPaidSplit(row) : null;
  const splitAccommodation = split ? split.accommodationCents / 100 : 0;
  const splitTax = split ? split.taxCents / 100 : 0;
  // A split that pro-rated its money names no line: the lines then read as they do without one.
  const splitLines = split && (split.lines || []).reduce((sum, line) => sum + line.cents, 0) === split.optionsCents + split.resourcesCents ? split.lines || [] : null;
  const splitOf = new Map((splitLines || []).map((line) => [line.key, line.cents / 100]));
  // Contribs describe a paid entry when they add up to it (accountingModel's tolerance); otherwise the export booked
  // it on the stored-money split, which knows no line.
  const describes = (field, lineField, taxField, amount) => Math.abs(round2(nz(row[field]) + nz(row[taxField])
    + lines.reduce((sum, line) => sum + nz(line[lineField]), 0)) - round2(amount)) <= 0.02;
  const known = (deposit || balance)
    && (!deposit || describes('accommodationAcompteContribTtc', 'acompteContribTtc', 'touristTaxAcompteContribTtc', row.depositAmount))
    && (!balance || describes('accommodationSoldeContribTtc', 'soldeContribTtc', 'touristTaxSoldeContribTtc', row.balanceAmount));
  const out = {};
  // Rule 55 (verification R34b-3) — a split's shares are not whole cents: its lines are summed exact and rounded once, at
  // the end (`settleSplitCents`), so they add up to the money received on each side, never a cent short.
  const exact = hasSplitShares(splitShares);
  const cent = (amount) => (exact ? amount : round2(amount));
  const add = (key, amount) => { out[key] = cent((out[key] || 0) + amount); };
  const addLateOffTheFiche = (onTheFiche) => {
    for (const [key, { amount }] of late) if (!onTheFiche.has(key)) add(key, amount);
  };
  if (!known) {
    // Without contribs that describe the money, the extras are known only as a bucket: a line paid at arrival collected
    // its amount once the complement is paid, nothing before. Reading of 2026-11-05 (audit R22-2): a complement alone
    // holds no line paid before arrival, unless a plan's installments hold them. The accommodation and the tax collected
    // what the acompte and the solde were booked on there (`booked`, bookedStayBuckets).
    const preArrivalKnownEmpty = (complement || late.size > 0) && !deposit && !balance && !(nz(row.installmentsPaidAmount) > 0);
    for (const line of billed) {
      const key = keyOf(line);
      if (!key) continue;
      const atDoor = lateOf(key);
      if (Number(line.inComplement || 0) === 1) add(key, atDoor + (!complement ? 0 : complementShare * (splitLines ? nz(splitOf.get(key)) : Math.max(0, round2(line.totalPrice - atDoor)))));
      else if (preArrivalKnownEmpty) add(key, atDoor + complementShare * nz(splitOf.get(key)));
    }
    const depositBuckets = deposit && booked ? booked.deposit : null;
    const soldeBuckets = balance && booked ? booked.solde : null;
    if ((!deposit || depositBuckets) && (!balance || soldeBuckets)) {
      const soldeTax = nz(soldeBuckets && soldeBuckets.touristTax);
      // Reading of 2026-11-05 (R22 verification, L1) — a plan's installments are book money on the accommodation and the
      // tax. Left out, the requalification came off the complement's money alone, whose sale room fell to 0: 42,40 €
      // collected stayed on no line of the register. A plan never sits beside a paid acompte or solde (D2).
      const plan = (!cash && booked && booked.installments) || { accommodation: 0, touristTax: 0, options: 0, resources: 0 };
      out[ACCOMMODATION_KEY] = cent(depositShare * nz(depositBuckets && depositBuckets.accommodation) + balanceShare * nz(soldeBuckets && soldeBuckets.accommodation)
        + plan.accommodation + (!complement ? 0 : complementShare * (split ? splitAccommodation : nz(row.extraGuestComplementSurcharge))));
      out[TOURIST_TAX_KEY] = cent(plan.touristTax + (!complement
        ? balanceShare * soldeTax
        : (split ? balanceShare * soldeTax + complementShare * splitTax
          : complementShare * (balance || taxOnArrival ? round2(row.touristTaxTotal) : nz(row.touristTaxAddedGuestsAmount)))));
      // Reading of 2026-11-05 (audit R23 N5) — what the plan booked on a bucket beyond the lines still naming it: a paid line
      // removed, lowered or moved to the complement since. The cents a split rounds are not a line.
      for (const { bucket, key } of PLAN_BUCKET_LINES) {
        const held = billed.filter((line) => Number(line.inComplement || 0) !== 1 && bucketOfKey(keyOf(line)) === bucket)
          .reduce((sum, line) => sum + Math.max(0, Number(line.totalPrice) || 0), 0);
        const beyond = round2(nz(plan[bucket]) - held);
        if (beyond > STORED_SPLIT_ROUNDING_TTC) out[key] = beyond;
      }
    }
    addLinesOnlyTheSplitNames(out, splitOf, billed, complementShare, cent);
    addLateOffTheFiche(new Set(billed.map(keyOf)));
    takeGesteOff(out, splitShares, cash);
    settleSplitCents(out, exact);
    return Object.keys(out).length ? out : null;
  }
  for (const line of lines) {
    const key = keyOf(line);
    if (!key) continue;
    const atDoor = lateOf(key);
    const total = Math.max(0, round2(line.totalPrice - atDoor));
    let atArrival = 0;
    if (complement && splitLines) atArrival = nz(splitOf.get(key));
    else if (complement && Number(line.inComplement || 0) === 1) atArrival = total;
    else if (complement && balance) atArrival = Math.max(0, round2(total - nz(line.acompteContribTtc) - nz(line.soldeContribTtc)));
    add(key, depositShare * nz(line.acompteContribTtc) + balanceShare * nz(line.soldeContribTtc) + complementShare * atArrival + atDoor);
  }
  const extrasTtc = round2(billed.reduce((sum, line) => sum + Number((line && line.totalPrice) || 0), 0));
  const accommodationTtc = Math.max(0, round2(Number(row.finalPrice || 0) - extrasTtc));
  const acompteTax = nz(row.touristTaxAcompteContribTtc);
  const accommodationContribs = nz(row.accommodationAcompteContribTtc) + nz(row.accommodationSoldeContribTtc);
  let complementAccommodation = 0;
  if (complement) {
    if (split) complementAccommodation = splitAccommodation;
    else complementAccommodation = balance ? Math.max(0, accommodationTtc - accommodationContribs) : nz(row.extraGuestComplementSurcharge);
  }
  out[ACCOMMODATION_KEY] = cent(depositShare * (nz(row.accommodationAcompteContribTtc) + acompteTax)
    + balanceShare * Math.max(0, nz(row.accommodationSoldeContribTtc) - acompteTax)
    + complementShare * complementAccommodation);
  const taxContribs = acompteTax + nz(row.touristTaxSoldeContribTtc);
  let complementTax = 0;
  if (complement) {
    if (split) complementTax = splitTax;
    else complementTax = balance || taxOnArrival ? Math.max(0, round2(row.touristTaxTotal) - taxContribs) : nz(row.touristTaxAddedGuestsAmount);
  }
  out[TOURIST_TAX_KEY] = cent(balanceShare * taxContribs + complementShare * complementTax);
  addLinesOnlyTheSplitNames(out, splitOf, lines, complementShare, cent);
  addLateOffTheFiche(new Set(lines.map(keyOf)));
  takeGesteOff(out, splitShares, cash);
  settleSplitCents(out, exact);
  return out;
}

const hasSplitShares = (splitShares) => Boolean(splitShares) && Object.keys(splitShares).length > 0;

// specs/mixed-method-payments.md rule 52 (audit R34 NEW-3) — the geste commercial of a split payment, its lines read gross
// (`bucketSharesOf`), comes off the accommodation, as the export books it on 70900000. Rule 54 (verification R34b-2): a geste
// the accommodation cannot hold (a complement paid before the solde) comes off the other lines for the rest, the extras
// pro rata, the tax last, so no line answers for more than it collected.
function takeGesteOff(out, splitShares, cash) {
  if (!splitShares) return;
  let geste = Object.values(splitShares).reduce((sum, s) => sum + Number((cash ? s.waivedInternal : s.waivedBooks) || 0), 0);
  if (!(geste > 0)) return;
  const takeFrom = (key, amount) => {
    const taken = Math.min(amount, Math.max(0, out[key] || 0));
    if (taken > 0) out[key] -= taken;
    geste -= taken;
  };
  if (out[ACCOMMODATION_KEY] != null) takeFrom(ACCOMMODATION_KEY, geste);
  const extras = Object.keys(out).filter((key) => key !== ACCOMMODATION_KEY && key !== TOURIST_TAX_KEY && out[key] > 0);
  const held = extras.reduce((sum, key) => sum + out[key], 0);
  if (geste > 0 && held > 0) {
    const share = Math.min(1, geste / held);
    for (const key of extras) takeFrom(key, out[key] * share);
  }
  if (geste > 1e-9 && out[TOURIST_TAX_KEY] != null) takeFrom(TOURIST_TAX_KEY, geste);
}

// Rule 55 (verification R34b-3) — the exact amounts of a split reading, in cents that add up to their exact total:
// each line its whole cents, the cents left to the lines with the largest remainders (largest-remainder rounding). Any
// other reading is in cents per line (a geste spread over the extras, rule 54, included).
function settleSplitCents(out, exact) {
  const keys = Object.keys(out);
  if (!exact) {
    for (const key of keys) out[key] = round2(out[key]);
    return;
  }
  const exactCents = keys.map((key) => Math.max(0, Math.round(Number(out[key]) * 1e8) / 1e6));
  const floors = exactCents.map((c) => Math.floor(c));
  let left = Math.round(exactCents.reduce((sum, c) => sum + c, 0)) - floors.reduce((sum, c) => sum + c, 0);
  const order = keys.map((_, i) => i).sort((a, b) => (exactCents[b] - floors[b]) - (exactCents[a] - floors[a]) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  keys.forEach((key, i) => { out[key] = floors[i] / 100; });
}

// What a stay collected after its arrival on the books, per line key: a paid end-of-stay complement's lines (the excess of
// rule 20 under its own key, booked as a prestation) and the notes. A SAS line with no key names no line of the fiche.
function collectedAfterArrival(row, splitShares = null) {
  const out = new Map();
  const add = (key, label, amount) => {
    if (!key || !(amount > 0)) return;
    const known = out.get(key);
    out.set(key, { label: (known && known.label) || label, amount: round2((known ? known.amount : 0) + amount) });
  };
  if (Number(row.endOfStayComplementPaid) === 1 && !Number(row.endOfStayComplementPaidCash || 0)) {
    // specs/mixed-method-payments.md rule 46 — paid with several methods: only its share on the books.
    const split = splitShares && splitShares.endOfStayComplement;
    const share = split ? split.books : 1;
    for (const line of parseDetail(row.endOfStayComplementDetail)) if (line) add(line.key, line.label, round2(share * (Number(line.amount) || 0)));
  }
  const notes = parseNotes(row.midStaySettledNotes).filter((note) => note && !Number(note.paidCash || 0));
  const labels = new Map(notes.flatMap((note) => note.lines || []).map((line) => [line && line.key, line && line.label]));
  for (const [key, amount] of Object.entries(settledByKey(notes, { withArrival: true }))) add(key, labels.get(key), amount);
  return out;
}

// A line the complement's split names that left the fiche since: what it collected still reads on its key.
function addLinesOnlyTheSplitNames(out, splitOf, lines, share = 1, cent = round2) {
  const onTheFiche = new Set(lines.map((line) => (line.removed ? line.key : billedLineKey(line))));
  for (const [key, amount] of splitOf) {
    if (!onTheFiche.has(key)) out[key] = cent((out[key] || 0) + share * amount);
  }
}

/**
 * Rule 49 reading of 2026-11-05 (D11) — the lines that collected money and are no longer on the fiche: the paid lines
 * removed since, and those a collected complement names. `collected` is `collectedByLine`'s reading of the same stay,
 * book money and caisse interne together.
 */
function collectedLinesGone({ reservation, options = [], resources = [], collected = null, cashCollected = null }) {
  const row = reservation || {};
  const onTheFiche = new Set([...options, ...resources].filter((line) => line && Number(line.offered || 0) !== 1).map(billedLineKey));
  const named = new Map();
  for (const entry of parseRemovedLineContribs(row.removedLineContribs)) named.set(entry.key, entry);
  for (const line of (readComplementPaidSplit(row) || { lines: [] }).lines || []) named.set(line.key, line);
  for (const [key, { label }] of collectedAfterArrival(row)) named.set(key, { label, bucket: bucketOfKey(key) });
  for (const line of PLAN_BUCKET_LINES) named.set(line.key, line);
  const gone = [];
  for (const [key, entry] of named) {
    if (onTheFiche.has(key)) continue;
    const collectedTtc = round2(Number((collected && collected[key]) || 0) + Number((cashCollected && cashCollected[key]) || 0));
    if (collectedTtc > 0) gone.push({ key, label: entry.label || 'Prestation', bucket: entry.bucket === 'resources' ? 'resources' : 'options', collectedTtc });
  }
  return gone;
}

/**
 * A line keyed by its bucket (`options`, `resources`) names no billed line: it is the requalification avoir of
 * a cancellation, which reverses a whole bucket (specs/reservation-refunds.md rule 45). It consumes the
 * bucket's lines pro rata of what each still had to give back when it was written (`roomOf`), by largest remainder
 * (rule 46): every cent of it lands on a line that still had it, so the register never offers again what the
 * cancellation requalified. `withheldShare`: the amount is a commission withheld (rule 48 reading of 2026-11-02), which
 * the indemnity never gives back.
 */
function spreadBucketRefund(lines, amountTtc, roomOf = (line) => line.refundableTtc, withheldShare = false) {
  const totalCents = Math.round(Number(amountTtc || 0) * 100);
  const remaining = lines.filter((line) => roomOf(line) > 0);
  const lineCents = remaining.map((line) => Math.round(roomOf(line) * 100));
  const availableCents = lineCents.reduce((sum, c) => sum + c, 0);
  if (totalCents <= 0 || availableCents <= 0) return;
  const spentCents = Math.min(totalCents, availableCents);
  const takes = lineCents.map((c) => Math.floor((spentCents * c) / availableCents));
  let leftCents = spentCents - takes.reduce((sum, c) => sum + c, 0);
  lineCents
    .map((c, index) => ({ index, rest: (spentCents * c) % availableCents }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
    .forEach(({ index }) => {
      if (leftCents <= 0 || takes[index] >= lineCents[index]) return;
      takes[index] += 1;
      leftCents -= 1;
    });
  remaining.forEach((line, index) => {
    line.requalifiedTtc = round2(line.requalifiedTtc + takes[index] / 100);
    if (withheldShare) line.withheldTtc = round2(line.withheldTtc + takes[index] / 100);
    line.refundableTtc = Math.max(0, round2(line.refundableTtc - takes[index] / 100));
  });
}

/**
 * What a reservation gave back on its TOURIST TAX (specs/reservation-refunds.md §3.5).
 *
 * Counts EVERY means, caisse interne included: « hors comptabilité » only ever meant « out of the
 * turnover ». Towards the commune what matters is that the tax physically went back to the guest, so
 * it is not owed — whatever envelope it left in.
 *
 * `nights` is rounded to a whole night: the declaration counts nights, not fractions. A token refund
 * smaller than half a night therefore removes 0 night and only shrinks the amount.
 */
function refundedTouristTax(refunds) {
  let amount = 0;
  let nights = 0;
  for (const refund of refunds || []) {
    for (const line of refund.lines || []) {
      if (line.lineKey !== TOURIST_TAX_KEY) continue;
      amount = round2(amount + Number(line.amountTtc || 0));
      nights += Number(line.quantity || 0);
    }
  }
  return { amount, nights: Math.max(0, Math.round(nights)) };
}

/** Split a TTC amount into HT + VAT at the line's frozen rate. A 0-rate line is entirely HT. */
function splitHtVat(amountTtc, vatRate) {
  const ttc = round2(amountTtc);
  const rate = Number(vatRate || 0);
  if (!ttc) return { ht: 0, vat: 0 };
  if (rate <= 0) return { ht: ttc, vat: 0 };
  const vat = round2(ttc * (rate / (100 + rate)));
  return { ht: round2(ttc - vat), vat };
}

/**
 * specs/reservation-refunds.md rule 53 (verification R35b, finding 5) — the latest day a payment of the stay reached the
 * books: a paid acompte, solde, arrival or end-of-stay complement off the caisse interne, a paid installment, a note
 * settled on the books, a settlement with a book tender. `null` when none did. A book refund dated before it is refused:
 * the refund closing the stay's books (mixed-method-payments rules 56, 58) reads the encaissements up to its own date.
 */
function lastBookPaymentDateOf(row, { installments = [], settlements = [] } = {}) {
  const r = row || {};
  const days = [];
  for (const [flag, cash, date] of [
    ['depositPaid', 'depositPaidCash', 'depositPaidDate'],
    ['balancePaid', 'balancePaidCash', 'balancePaidDate'],
    ['complementPaid', 'complementPaidCash', 'complementPaidDate'],
    ['endOfStayComplementPaid', 'endOfStayComplementPaidCash', 'endOfStayComplementPaidDate'],
  ]) if (Number(r[flag]) === 1 && !Number(r[cash] || 0)) days.push(r[date]);
  for (const installment of installments) if (Number(installment.paid) === 1) days.push(installment.paidDate);
  for (const note of parseNotes(r.midStaySettledNotes)) if (note && !Number(note.paidCash || 0)) days.push(note.paidDate);
  for (const settlement of settlements) {
    if ((settlement.tenders || []).some((t) => !(Number(t.internal) === 1 || t.internal === true) && Number(t.amountCents) > 0)) days.push(settlement.paidDate);
  }
  const real = days.map((day) => String(day || '').slice(0, 10)).filter(isRealIsoDay).sort();
  return real.length ? real[real.length - 1] : null;
}

function invalid(code, error, status = 400) {
  return { code, error, status };
}

/**
 * Validate + normalize a refund creation payload (spec §3.2 rules 9–14).
 *
 * Keyed lines take their bucket, unit price and VAT rate from the refundable line — the client only
 * chooses *how much*. Free lines carry an operator-chosen bucket and no cap of their own; they are
 * still bound by the global cap.
 *
 * @returns {{error: string, code: string, status: number}|{refund: object}}
 */
function validateRefundPayload(payload, context) {
  const {
    refundableLines = [], finalPrice = 0, touristTaxTotal = 0,
    alreadyRefundedTotal = 0, vatRate = 0, today, cancelled = null, liveCollectedTtc = null, lastBookPaymentDate = null,
  } = context || {};

  const refundDate = String((payload && payload.refundDate) || '').trim();
  if (!isRealIsoDay(refundDate)) {
    return invalid('REFUND_INVALID_DATE', 'Date de remboursement invalide');
  }
  if (today && refundDate > today) {
    return invalid('REFUND_INVALID_DATE', 'La date de remboursement ne peut pas être dans le futur');
  }
  // specs/reservations-backend-mvc.md rule 13 (reading of 2026-11-02) — not before today − 5 years.
  const outside = dateWindowMessage(refundDate, today || undefined);
  if (outside) return invalid('REFUND_INVALID_DATE', outside);

  // Operator-facing methods only: `retained` is written by the cancellation flow, never requested.
  const method = String((payload && payload.method) || 'transfer');
  if (!SELECTABLE_REFUND_METHODS.includes(method)) {
    return invalid('REFUND_INVALID_METHOD', 'Moyen de remboursement inconnu');
  }
  // Rule 53 — a book refund is never dated before the stay's last book payment.
  if (!isOffBooks(method) && lastBookPaymentDate && refundDate < lastBookPaymentDate) {
    const [y, m, d] = lastBookPaymentDate.split('-');
    return invalid('REFUND_BEFORE_PAYMENT', `Date antérieure au dernier paiement (${d}/${m}/${y}).`);
  }

  const rawLines = Array.isArray(payload && payload.lines) ? payload.lines : [];
  if (rawLines.length === 0) {
    return invalid('REFUND_INVALID_AMOUNT', 'Aucune ligne à rembourser');
  }

  const byKey = new Map(refundableLines.map((l) => [l.key, l]));
  const requestedByKey = {};
  const lines = [];

  for (const raw of rawLines) {
    const amountTtc = round2(raw && raw.amountTtc);
    if (!(amountTtc > 0)) {
      return invalid('REFUND_INVALID_AMOUNT', 'Chaque ligne remboursée doit porter un montant positif');
    }
    const key = raw && raw.key ? String(raw.key) : null;

    if (key) {
      const billed = byKey.get(key);
      if (!billed) {
        return invalid('REFUND_UNKNOWN_LINE', 'Cette prestation n’est pas remboursable sur cette réservation');
      }
      requestedByKey[key] = round2((requestedByKey[key] || 0) + amountTtc);
      if (requestedByKey[key] > billed.refundableTtc) {
        return invalid(
          'REFUND_EXCEEDS_LINE',
          `« ${billed.label} » : le remboursement dépasse le montant restant remboursable (${euros(billed.refundableTtc)})`,
          409,
        );
      }
      // Quantity is DERIVED from the amount, never trusted from the client: it is what the tourist-tax
      // declaration deducts in nights (spec §3.5 rule 28), so amount and quantity can never disagree.
      const unitPrice = Number(billed.unitPrice) > 0 ? Number(billed.unitPrice) : null;
      const quantity = unitPrice ? Math.round((amountTtc / unitPrice) * 10000) / 10000 : null;
      lines.push({
        lineKey: key,
        label: billed.label,
        bucket: billed.bucket,
        quantity,
        unitPrice,
        amountTtc,
        vatRate: billed.vatRate,
      });
      continue;
    }

    // Free line — the commercial-gesture escape hatch (rule 9).
    const label = String((raw && raw.label) || '').trim();
    if (!label) {
      return invalid('REFUND_INVALID_LINE', 'Une ligne libre doit porter un libellé');
    }
    const bucket = String((raw && raw.bucket) || 'options');
    if (!REFUND_BUCKETS.includes(bucket)) {
      return invalid('REFUND_INVALID_LINE', 'Catégorie de remboursement inconnue');
    }
    lines.push({
      lineKey: null,
      label,
      bucket,
      quantity: null,
      unitPrice: null,
      amountTtc,
      vatRate: bucket === 'touristTax' ? 0 : Number(vatRate || 0),
    });
  }

  const totalTtc = round2(lines.reduce((sum, l) => sum + l.amountTtc, 0));
  if (cancelled) {
    const reachable = round2(cancelled.collectedTtc + Number(cancelled.cashLeftTtc || 0));
    if (totalTtc > reachable) {
      return invalid('REFUND_EXCEEDS_COLLECTED', `Dépasse l’encaissé (${euros(reachable)}).`, 409);
    }
    const split = splitOnIndemnity(lines, byKey, cancelled, method === OFF_BOOKS_METHOD);
    if (split.error) return split;
    lines.splice(0, lines.length, ...split.lines);
  }
  if (!(totalTtc > 0)) {
    return invalid('REFUND_INVALID_AMOUNT', 'Le montant total du remboursement doit être positif');
  }
  // Rule 50 (D10) — on a live stay too, a book refund never exceeds what was collected: money never received cannot go back.
  if (!cancelled && !isOffBooks(method) && liveCollectedTtc != null && totalTtc > round2(liveCollectedTtc)) {
    return invalid('REFUND_EXCEEDS_COLLECTED', `Dépasse l’encaissé (${euros(Math.max(0, round2(liveCollectedTtc)))}).`, 409);
  }
  // Rule 51 (D15) — within that total, a line gives back what it collected. Free lines answer to the total alone.
  if (!cancelled && !isOffBooks(method)) {
    const refused = (left) => invalid('REFUND_EXCEEDS_LINE_COLLECTED', left > 0 ? `Disponible sur cette ligne : ${euros(left)}.` : 'Rien d’encaissé sur cette ligne.', 409);
    const sharedAsked = {};
    for (const [key, asked] of Object.entries(requestedByKey)) {
      const line = byKey.get(key);
      if (line.availableTtc != null && asked > line.availableTtc) return refused(line.availableTtc);
      if (line.sharedBucketTtc == null) continue;
      sharedAsked[line.bucket] = round2((sharedAsked[line.bucket] || 0) + asked);
      if (sharedAsked[line.bucket] > line.sharedBucketTtc) return refused(Math.max(0, round2(line.sharedBucketTtc - sharedAsked[line.bucket] + asked)));
    }
  }

  // Rule 49 reading of 2026-11-05 (audit R22-4) — a cancelled stay is judged by what it collected (above), never by what
  // it still bills: a line lowered or removed since would make that money unreachable.
  const stayCap = round2(Number(finalPrice || 0) + Number(touristTaxTotal || 0));
  if (!cancelled && round2(Number(alreadyRefundedTotal || 0) + totalTtc) > stayCap) {
    return invalid(
      'REFUND_EXCEEDS_STAY',
      `Le total remboursé dépasserait le montant du séjour (${stayCap.toFixed(2).replace('.', ',')} €).`,
      409,
    );
  }

  return {
    refund: {
      refundDate,
      method,
      reason: String((payload && payload.reason) || '').trim(),
      totalTtc,
      lines,
    },
  };
}

// Lazy: reservationLedger requires this module.
const euros = (n) => require('./reservationLedger').formatEuros(n);

/**
 * Rule 48 — on a cancelled stay, each line is given back first from the collected money no cancellation
 * requalified (it keeps its bucket and VAT: the sale is reversed), then from the indemnity (bucket `indemnity`,
 * 0 %). The indemnity part of a sold line never exceeds what the cancellation requalified on it.
 * Rule 48 reading of 2026-11-02 (audit R15-L1) — a caisse-interne refund takes the caisse interne's own money first,
 * then the sale money, never the indemnity; a book refund never takes the caisse interne's money.
 */
function splitOnIndemnity(lines, byKey, budget, offBooks = false) {
  let saleLeft = Math.round(budget.saleLeftTtc * 100);
  let indemnityLeft = Math.round(budget.indemnityLeftTtc * 100);
  let cashLeft = Math.round(Number(budget.cashLeftTtc || 0) * 100);
  const saleRoom = {};
  const indemnityRoom = {};
  const cashRoom = {};
  for (const [key, line] of byKey) {
    indemnityRoom[key] = Math.round(Number(line.indemnityTtc || 0) * 100);
    cashRoom[key] = Math.round(Number(line.cashTtc || 0) * 100);
    saleRoom[key] = Math.round(line.refundableTtc * 100) - indemnityRoom[key] - cashRoom[key];
  }
  const out = [];
  for (const line of lines) {
    const cents = Math.round(line.amountTtc * 100);
    const key = line.lineKey;
    const room = (rooms, left) => Math.min(left, key ? Math.max(0, rooms[key]) : left);
    const cash = offBooks ? Math.min(cents, room(cashRoom, cashLeft)) : 0;
    const sale = Math.min(cents - cash, room(saleRoom, saleLeft));
    const fromIndemnity = cents - cash - sale;
    if (fromIndemnity > 0 && (offBooks || fromIndemnity > room(indemnityRoom, indemnityLeft))) {
      const billed = key ? byKey.get(key) : null;
      // Rule 49 — what is really left for this line once the earlier lines of the refund took their share.
      const leftCents = room(saleRoom, saleLeft) + room(indemnityRoom, indemnityLeft) + room(cashRoom, cashLeft);
      if (offBooks && fromIndemnity <= room(indemnityRoom, indemnityLeft)) {
        return invalid('REFUND_INDEMNITY_OFF_BOOKS', 'Pris sur l’indemnité : virement ou espèces seulement.', 409);
      }
      if (!offBooks && cents <= leftCents) {
        return invalid('REFUND_CASH_ONLY_IN_CASH', 'Encaissé en caisse interne : rendu en caisse interne seulement.', 409);
      }
      return billed
        ? invalid('REFUND_EXCEEDS_LINE', `« ${billed.label} » : dépasse l’encaissé restant (${euros(leftCents / 100)}).`, 409)
        : invalid('REFUND_EXCEEDS_COLLECTED', `Dépasse l’encaissé restant (${euros(leftCents / 100)}).`, 409);
    }
    saleLeft -= sale;
    indemnityLeft -= fromIndemnity;
    cashLeft -= cash;
    if (key) {
      saleRoom[key] -= sale;
      indemnityRoom[key] -= fromIndemnity;
      cashRoom[key] -= cash;
    }
    const part = (amountCents) => ({
      ...line,
      amountTtc: amountCents / 100,
      quantity: line.unitPrice ? Math.round((amountCents / 100 / line.unitPrice) * 10000) / 10000 : line.quantity,
    });
    if (cash + sale > 0) out.push(part(cash + sale));
    if (fromIndemnity > 0) out.push({ ...part(fromIndemnity), bucket: INDEMNITY_BUCKET, vatRate: 0 });
  }
  return { lines: out };
}

module.exports = {
  lastBookPaymentDateOf,
  REFUND_METHODS,
  SELECTABLE_REFUND_METHODS,
  RETAINED_DEPOSIT_METHOD,
  REFUND_BUCKETS,
  INDEMNITY_BUCKET,
  OFF_BOOKS_METHOD,
  ACCOMMODATION_KEY,
  TOURIST_TAX_KEY,
  COMMISSION_KEY,
  isOffBooks,
  isRetainedDeposit,
  isIndemnityLine,
  cancelledRefundBudget,
  collectedByLine,
  collectedLinesGone,
  nettedByCancellation,
  refundDeletionRefusal,
  madeAfterCancellation,
  billedLineKey,
  refundedByKey,
  refundedTouristTax,
  refundsTotal,
  buildRefundableLines,
  splitHtVat,
  validateRefundPayload,
  round2,
};
