/**
 * REFUNDS / register — what a refund is and how the register reads (specs/pricing-components.md §3 rule 72).
 *
 * The classification of a refund (book money, caisse interne, the `retained` requalification avoir), of its lines (sale,
 * indemnity, commission), the order of a refund relative to the cancellation, and the per-line sums of the register. Moved
 * from `utils/refunds.js` as it was; that module re-exports it. Pure: no DB, no clock. Keeps its own `round2`.
 */

const { extraLineKey } = require('../storedLines');

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

module.exports = {
  round2,
  REFUND_METHODS,
  SELECTABLE_REFUND_METHODS,
  RETAINED_DEPOSIT_METHOD,
  OFF_BOOKS_METHOD,
  REFUND_BUCKETS,
  INDEMNITY_BUCKET,
  STORED_SPLIT_ROUNDING_TTC,
  ACCOMMODATION_KEY,
  TOURIST_TAX_KEY,
  COMMISSION_KEY,
  ACCOMMODATION_LABEL,
  TOURIST_TAX_LABEL,
  PLAN_BUCKET_LINES,
  bucketOfKey,
  isOffBooks,
  isRetainedDeposit,
  billedLineKey,
  lineLabelOf,
  refundedByKey,
  isRequalification,
  isIndemnityLine,
  isCommissionLine,
  nettedByCancellation,
  madeAfterCancellation,
  writtenBeforeAvoir,
};
