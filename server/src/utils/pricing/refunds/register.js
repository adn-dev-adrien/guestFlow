/**
 * REFUNDS / register — what a refund is and how the register reads (specs/pricing-components.md §3 rule 72).
 *
 * The classification of a refund (book money, caisse interne, the `retained` requalification avoir), of its lines (sale,
 * indemnity, commission), the order of a refund relative to the cancellation, and the per-line sums of the register. Moved
 * from `utils/refunds.js` as it was; that module re-exports it. Pure: no DB, no clock. Keeps its own `round2`.
 */

const { extraLineKey } = require('../storedLines');

const { roundMoneyOrZero: round2 } = require('../money');

// Means of refund. `transfer` + `cash` are book money; `internal` (caisse interne) stays off the
// books, exactly like the cash complements (specs/cash-complement-and-endofstay-finance.md).
// `retained` is book money too, but no money moves: it is the requalification avoir written when a
// stay is cancelled for non-payment and the acompte is kept as an indemnity
// (specs/payment-schedule-and-cancellation.md §3.6 rule 32). It is never operator-selectable — only
// the cancellation flow writes it — so it stays out of `SELECTABLE_REFUND_METHODS`.
const REFUND_METHODS = ['transfer', 'cash', 'internal', 'retained', 'card'];

// `card` (owner O-3): the guest's card was refunded from the provider's space, by hand; GuestFlow calls no refund API and keeps
// the provider's reference (`providerRefundRef`) beside the refund. It is book money, like a transfer.
const SELECTABLE_REFUND_METHODS = ['transfer', 'cash', 'internal', 'card'];

const RETAINED_DEPOSIT_METHOD = 'retained';

const OFF_BOOKS_METHOD = 'internal';

const CARD_METHOD = 'card';

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

// ── The contract names (rule 72): classify, totals({scope}), order ────────────────────────────────────────────────────────

/**
 * What a refund is: `{ kind: 'refund' | 'requalification', book: boolean, offBooks: boolean }`. A `retained` avoir gives
 * nothing back (the acompte stays, requalified as an indemnity); a caisse-interne refund is off the books.
 */
function classify(refund) {
  const method = String((refund && refund.method) || '');
  return { kind: method === RETAINED_DEPOSIT_METHOD ? 'requalification' : 'refund', book: method !== OFF_BOOKS_METHOD, offBooks: method === OFF_BOOKS_METHOD };
}

/** What a refund line is: `{ source: 'sale' | 'indemnity' | 'commission' }` (the caisse is a label of the means, never of the line, D8). */
function classifyLine(line) {
  if (isIndemnityLine(line)) return { source: 'indemnity' };
  if (isCommissionLine(line)) return { source: 'commission' };
  return { source: 'sale' };
}

/**
 * The ONE declared filter of every reader of the register. A scope names which refunds a reading counts, per means:
 *
 *   given     the money that went back to the guest — the requalification avoir moves none (the fiche, the caps, the take-back guard)
 *   journal   the accounting export of a month — the avoir is an entry of the cancellation month, the caisse interne is not in the books
 *   turnover  the franchise turnover and the « Encaissé » of the finance views — the avoir reverses revenue, the caisse interne is in
 *             the cash reading only
 *   commune   the tourist tax owed to the commune — every means: « hors comptabilité » leaves the turnover, never what the commune is owed
 *
 * `book` reads the books (the caisse interne out), `withCash` everything the scope counts. `sql` is the same predicate for the
 * finance queries, so a statement and the JS reading cannot diverge (`pricing-refunds-register` proves the parity on every means).
 */
const SCOPES = {
  given: {
    book: (m) => m !== RETAINED_DEPOSIT_METHOD && m !== OFF_BOOKS_METHOD,
    withCash: (m) => m !== RETAINED_DEPOSIT_METHOD,
    sql: { book: (col) => `${col} <> 'retained' AND ${col} <> 'internal'`, withCash: (col) => `${col} <> 'retained'` },
  },
  journal: {
    book: (m) => m !== OFF_BOOKS_METHOD,
    withCash: (m) => m !== OFF_BOOKS_METHOD,
    sql: { book: (col) => `${col} <> 'internal'`, withCash: (col) => `${col} <> 'internal'` },
  },
  turnover: {
    book: (m) => m !== OFF_BOOKS_METHOD,
    withCash: () => true,
    sql: { book: (col) => `${col} <> 'internal'`, withCash: () => '1 = 1' },
  },
  commune: {
    book: () => true,
    withCash: () => true,
    sql: { book: () => '1 = 1', withCash: () => '1 = 1' },
  },
};

const scopeOf = (scope) => {
  if (!SCOPES[scope]) throw new Error(`refunds.totals: unknown scope « ${scope} »`);
  return SCOPES[scope];
};

/** The predicate of a scope's reading (`book` or `withCash`) over the refund's `method` column, for a SQL statement. */
function scopeSql(scope, reading, column = 'method') {
  return scopeOf(scope).sql[reading](column);
}

// The SQL read models of the finance pages and of the refunds model sum the register through these fragments, so that the scope of a
// reading (`scopeSql`) and the shape of a sum live next to the classification (rule 72). Each is a SELECT or a sub-select over
// `reservation_refunds` (alias `rf`) and `reservation_refund_lines` (alias `rl`).

/** The refunds of the stay `stayColumn` that the reading counts, summed in TTC. */
const refundsTotalSql = (scope, reading, stayColumn = 'r.id') => `COALESCE((SELECT SUM(rf.totalTtc) FROM reservation_refunds rf
                 WHERE rf.reservationId = ${stayColumn} AND ${scopeSql(scope, reading, 'rf.method')}), 0)`;

/** The TTC of the lines of the refunds of the stay `stayColumn` that the reading counts, restricted by `lineWhere` (a SQL condition on `rl`). */
const refundLinesTotalSql = (scope, reading, lineWhere, stayColumn = 'r.id') => `COALESCE((SELECT SUM(rl.amountTtc) FROM reservation_refund_lines rl
                 JOIN reservation_refunds rf ON rf.id = rl.refundId
                 WHERE rf.reservationId = ${stayColumn} AND ${lineWhere} AND ${scopeSql(scope, reading, 'rf.method')}), 0)`;

/** What one refund `refundColumn` took from a cancellation indemnity, in TTC (rule 48). */
const indemnityOfRefundSql = (refundColumn = 'rf.id') => `(SELECT COALESCE(SUM(l.amountTtc), 0) FROM reservation_refund_lines l WHERE l.refundId = ${refundColumn} AND l.bucket = 'indemnity')`;

/** `SELECT … AS total` over the lines of a stay's refunds (`?` is the stay id) that the reading counts, restricted by `lineWhere` (on `l`, with the refund as `r`). */
const stayRefundLinesSumSql = (lineWhere) => `SELECT COALESCE(SUM(l.amountTtc), 0) AS total FROM reservation_refund_lines l
        JOIN reservation_refunds r ON r.id = l.refundId
        WHERE r.reservationId = ? AND ${lineWhere}`;

/**
 * `{ bookCents, withCashCents, freeCents, indemnityCents, byKey, byBucket, touristTax: { cents, nights } }` over a register,
 * for one scope. `freeCents` is the lines with no key (the « Trop-perçu » lines), `byKey` / `byBucket` the cents per line key and
 * per bucket, the tourist tax the cents and the nights given back (rule 27). Amounts are read in cents.
 */
function totals(refunds, { scope }) {
  const rule = scopeOf(scope);
  const out = { bookCents: 0, withCashCents: 0, freeCents: 0, indemnityCents: 0, byKey: {}, byBucket: {}, touristTax: { cents: 0, nights: 0 } };
  for (const refund of refunds || []) {
    const method = String(refund.method || '');
    const cents = Math.round(Number(refund.totalTtc || 0) * 100);
    if (rule.withCash(method)) out.withCashCents += cents;
    if (rule.book(method)) out.bookCents += cents;
    if (!rule.withCash(method)) continue;
    for (const line of refund.lines || []) {
      const amount = Math.round(Number(line.amountTtc || 0) * 100);
      if (!line.lineKey) out.freeCents += amount;
      else out.byKey[line.lineKey] = (out.byKey[line.lineKey] || 0) + amount;
      if (isIndemnityLine(line)) out.indemnityCents += amount;
      out.byBucket[line.bucket] = (out.byBucket[line.bucket] || 0) + amount;
      if (line.lineKey === TOURIST_TAX_KEY) {
        out.touristTax.cents += amount;
        out.touristTax.nights += Number(line.quantity || 0);
      }
    }
  }
  return out;
}

/** The order of the register relative to the cancellation: `{ after(refund), beforeAvoir(refund), netted(refund) }`. */
function order(refunds, cancelledAt = null, nettedIds = null) {
  return {
    after: (refund) => madeAfterCancellation(refund, refunds, cancelledAt),
    beforeAvoir: writtenBeforeAvoir(refunds),
    netted: (refund) => nettedByCancellation(refund, refunds, nettedIds),
  };
}

module.exports = {
  classify,
  classifyLine,
  totals,
  scopeSql,
  refundsTotalSql,
  refundLinesTotalSql,
  indemnityOfRefundSql,
  stayRefundLinesSumSql,
  order,
  SCOPES,
  round2,
  REFUND_METHODS,
  SELECTABLE_REFUND_METHODS,
  RETAINED_DEPOSIT_METHOD,
  OFF_BOOKS_METHOD,
  CARD_METHOD,
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
