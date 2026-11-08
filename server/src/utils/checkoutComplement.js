/**
 * Merged « complément de fin de séjour » — specs/defer-arrival-complement-to-checkout.md §3.2.
 *
 * When the operator settles the arrival complement with « En fin de séjour » on the check-in recap,
 * the reservation carries `complementDeferredToCheckout = 1`. From that moment there is only ONE
 * collection left, at the door: the (unpaid) arrival complement + whatever the departure SAS bills.
 * This builder produces the single block every operator-facing view renders — one detail list, one
 * total, one paid state.
 *
 * The two DB buckets stay separate on purpose (§3.2 rule 9): the pricing engine keeps recomputing
 * `complementAmount`, the tourist tax keeps its 46710000 routing and the end-of-stay complement its
 * 70600010 line. The merge is a presentation + collection contract, never a data move.
 */

// Label of the cleaning line the departure SAS bills when the end-of-stay cleaning was not done.
// Shared by the client (preview line) and the server guard that drops it when the cleaning is
// already sold (§3.1 rule 3).
const END_OF_STAY_CLEANING_LABEL = 'Ménage de fin de séjour';

const { parseGroup } = require('./arrivalPaymentGroup');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseDetail(detail) {
  if (Array.isArray(detail)) return detail;
  if (!detail) return [];
  try {
    const parsed = JSON.parse(detail);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

const flag = (v) => Number(v || 0) === 1;
const complementSettled = (row) => flag(row && row.complementPaid) || flag(row && row.complementPaidCash);
const endOfStaySettled = (row) => flag(row && row.endOfStayComplementPaid) || flag(row && row.endOfStayComplementPaidCash);
const day = (v) => String(v || '').slice(0, 10);

// Rule 24 (audit R29-DB-1) — an end of stay with nothing to collect, never settled: trivially settled, as `paid` reads it.
const nothingAtEndOfStay = (row) => round2(row.endOfStayComplementAmount) === 0 && !endOfStaySettled(row);

/**
 * Rule 8 (audit R28 verification V1) — the arrival complement and the end of stay settled by ONE collection: both
 * paid, same date, same caisse flag. That is what the merged card's own mark writes, so the card stays merged.
 * Rule 24 — at 0 € of end of stay, the merged card's mark settled the arrival part alone: still that one collection.
 * Rule 27 — a « paiement unique » is written, never derived: one naming one bucket and not the other is another collection.
 */
function settledTogether(row) {
  const r = row || {};
  if (!complementSettled(r)) return false;
  if (nothingAtEndOfStay(r)) return true;
  const group = parseGroup(r.arrivalPaymentGroup);
  const inGroup = (bucket) => Boolean(group && group.buckets.includes(bucket));
  return endOfStaySettled(r)
    && day(r.complementPaidDate) === day(r.endOfStayComplementPaidDate)
    && flag(r.complementPaidCash) === flag(r.endOfStayComplementPaidCash)
    && inGroup('complement') === inGroup('endOfStayComplement');
}

/** Rule 22 — an end of stay collected on its own (not with the arrival part): it keeps its own card and columns. */
const endOfStaySettledApart = (row) => endOfStaySettled(row) && !settledTogether(row);

/**
 * Rule 6 as every reader applies it (§3.2 edge cases, audit R28-C-M1 and its verification V1): the arrival complement
 * is merged into the end of stay while it is still to collect, or once both were settled together (rule 24: an end of
 * stay at 0 € included). Paid apart, or an arrival part at 0 €, the deferral marker merges nothing.
 * @param {object} row            carries the deferral marker and the complement / end-of-stay payment columns.
 * @param {number} [arrivalAmount] the arrival complement when it differs from the stored column (live quote).
 */
function isComplementDeferred(row, arrivalAmount) {
  const r = row || {};
  return flag(r.complementDeferredToCheckout)
    && round2(arrivalAmount === undefined ? r.complementAmount : arrivalAmount) > 0
    && (!complementSettled(r) || settledTogether(r));
}

/**
 * Rule 22 — the end-of-stay part the merged card holds: one settled apart keeps its own card and its stored columns,
 * so a mark never re-dates nor clears it; one settled together stays on the merged card.
 */
function mergedEndOfStayAmount(row, endOfStayAmount) {
  if (endOfStaySettledApart(row)) return 0;
  return round2(endOfStayAmount === undefined ? (row || {}).endOfStayComplementAmount : endOfStayAmount);
}

/** Whether a mark, un-mark or caisse switch of the arrival complement also writes the end-of-stay columns (rules 8, 22). */
const markCarriesEndOfStay = (row) => isComplementDeferred(row) && mergedEndOfStayAmount(row) > 0;

/**
 * Rule 25 (audit R29-RES-L1) — the 409 answered to an end-of-stay mark (books or caisse) sent without the arrival
 * complement while the merged card holds both and its arrival part is due, or null. Collected alone, the end of stay and a
 * complement marked later the same day would read as settled together, and the merged card's « Annuler » would clear both.
 * @param {object} row      the stored reservation row.
 * @param {object} body     the PATCH body, flags already normalised to booleans.
 */
function endOfStayAloneRefusal(row, body) {
  const b = body || {};
  if (b.endOfStayComplementPaid !== true && b.endOfStayComplementPaidCash !== true) return null;
  if (complementSettled(row) || b.complementPaid === true || b.complementPaidCash === true || !markCarriesEndOfStay(row)) return null;
  return { status: 409, body: { error: END_OF_STAY_WITH_ARRIVAL_COMPLEMENT_MESSAGE, code: END_OF_STAY_WITH_ARRIVAL_COMPLEMENT } };
}

// Rule 23 (audit R28 verification N2) — the deferral is never switched on over an end of stay already collected.
const DEFERRAL_END_OF_STAY_SETTLED = 'DEFERRAL_END_OF_STAY_SETTLED';
const DEFERRAL_END_OF_STAY_SETTLED_MESSAGE = 'Complément de fin de séjour déjà encaissé.';
const END_OF_STAY_WITH_ARRIVAL_COMPLEMENT = 'END_OF_STAY_WITH_ARRIVAL_COMPLEMENT';
const END_OF_STAY_WITH_ARRIVAL_COMPLEMENT_MESSAGE = 'Complément de fin de séjour : à percevoir avec le complément d’arrivée.';

/**
 * Rule 23 — the 409 answered to a switch of `complementDeferredToCheckout` from 0 to 1 while the end of stay is settled
 * (books or caisse interne), or null. A collection made apart and a complement marked the same day would otherwise read
 * as settled together (rule 22, V1 reading), and the merged card's « Annuler » would clear both. Sent back unchanged,
 * switched off, or with the end of stay due, it passes.
 * @param {object} row       the stored reservation row.
 * @param {boolean} deferred the marker asked for.
 */
function deferralRefusal(row, deferred) {
  if (!deferred || flag(row && row.complementDeferredToCheckout) || !endOfStaySettled(row)) return null;
  return { status: 409, body: { error: DEFERRAL_END_OF_STAY_SETTLED_MESSAGE, code: DEFERRAL_END_OF_STAY_SETTLED } };
}

/**
 * @param {object} reservation      row/payload carrying the complement columns.
 * @param {object} arrivalDetail    `{ amount, paid, detail[] }` from `buildArrivalComplementDetail`.
 * @returns {{ deferred: boolean, amount: number, arrivalAmount: number, endOfStayAmount: number,
 *            paid: boolean, paidCash: boolean, paidDate: string|null, lines: object[] }}
 */
function buildCheckoutComplement(reservation, arrivalDetail) {
  const r = reservation || {};
  const arrivalAmount = round2(arrivalDetail ? arrivalDetail.amount : r.complementAmount);
  // Deferred while the arrival complement is still to collect, or both were settled by the merged card's one
  // collection; paid apart, the two collections happened at two moments and keep their own cards (§3.2 edge cases).
  const deferred = isComplementDeferred(r, arrivalAmount);
  // Rule 22 — an end of stay settled apart is not part of the merged collection.
  const endOfStayAmount = deferred ? mergedEndOfStayAmount(r) : round2(r.endOfStayComplementAmount);
  const endOfStayLines = deferred && endOfStaySettledApart(r) ? [] : parseDetail(r.endOfStayComplementDetail);

  const lines = [
    ...((arrivalDetail && arrivalDetail.detail) || []).map((l) => ({
      label: l.label,
      qty: Number(l.qty || 1),
      unitPrice: round2(l.unitPrice),
      amount: round2(l.amount),
      origin: 'arrival',
    })),
    ...endOfStayLines.map((l) => ({
      label: l.label,
      qty: Number(l.qty || 1),
      unitPrice: round2(l.unitPrice != null ? l.unitPrice : l.amount),
      amount: round2(l.amount),
      origin: 'endOfStay',
    })),
  ].filter((l) => l.amount > 0);

  return {
    deferred,
    amount: round2(arrivalAmount + endOfStayAmount),
    arrivalAmount,
    endOfStayAmount,
    // Fully collected only when BOTH buckets are settled (a zero bucket is trivially settled).
    paid: (arrivalAmount === 0 || Number(r.complementPaid || 0) === 1)
      && (endOfStayAmount === 0 || Number(r.endOfStayComplementPaid || 0) === 1),
    paidCash: Number(r.complementPaidCash || 0) === 1 || Number(r.endOfStayComplementPaidCash || 0) === 1,
    paidDate: r.complementPaidDate || r.endOfStayComplementPaidDate || null,
    lines,
  };
}

/**
 * Same block, built from the LIVE quote instead of the stored row —
 * specs/defer-arrival-complement-to-checkout.md §3.2 rule 7bis.
 *
 * The stored block goes stale the moment the operator edits an option: the summary panel follows the
 * quote while the merged card kept showing the last save (« repas : 100 € » under a live total of
 * 158,05 € — Adrien, 2026-08-23). The controller therefore rebuilds the block from the fresh quote on
 * every calculate-price: amounts and arrival detail from the engine, end-of-stay lines from the
 * SAS-owned stored lines plus the engine's recomputed mid-stay lines, payment flags from the row
 * (they are persisted immediately by the fiche's buttons, so the row is current).
 *
 * @param {object} params.row   stored reservation row (payment flags + deferral marker + stored detail).
 * @param {object} params.quote fresh engine quote (`complementAmount`, `complementDetailLines`,
 *                              `endOfStayComplementTotal`, `midStayExtrasLines`).
 */
function buildLiveCheckoutComplement({ row, quote } = {}) {
  const r = row || {};
  const q = quote || {};
  const endOfStayLines = [
    ...parseDetail(r.endOfStayComplementDetail).filter((l) => l && l.source !== 'midStayExtra'),
    ...(q.midStayExtrasLines || []),
  ];
  return buildCheckoutComplement(
    {
      ...r,
      endOfStayComplementAmount: q.endOfStayComplementTotal,
      endOfStayComplementDetail: endOfStayLines,
    },
    { amount: q.complementAmount, paid: r.complementPaid, detail: q.complementDetailLines || [] },
  );
}

module.exports = {
  buildCheckoutComplement, buildLiveCheckoutComplement, isComplementDeferred, mergedEndOfStayAmount, markCarriesEndOfStay,
  endOfStaySettledApart, deferralRefusal, endOfStayAloneRefusal,
  DEFERRAL_END_OF_STAY_SETTLED, DEFERRAL_END_OF_STAY_SETTLED_MESSAGE,
  END_OF_STAY_WITH_ARRIVAL_COMPLEMENT, END_OF_STAY_WITH_ARRIVAL_COMPLEMENT_MESSAGE,
  END_OF_STAY_CLEANING_LABEL,
};
