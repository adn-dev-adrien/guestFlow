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

/**
 * Rule 8 (audit R28 verification V1) — the arrival complement and the end of stay settled by ONE collection: both
 * paid, same date, same caisse flag. That is what the merged card's own mark writes, so the card stays merged.
 */
function settledTogether(row) {
  const r = row || {};
  return complementSettled(r) && endOfStaySettled(r)
    && day(r.complementPaidDate) === day(r.endOfStayComplementPaidDate)
    && flag(r.complementPaidCash) === flag(r.endOfStayComplementPaidCash);
}

/** Rule 22 — an end of stay collected on its own (not with the arrival part): it keeps its own card and columns. */
const endOfStaySettledApart = (row) => endOfStaySettled(row) && !settledTogether(row);

/**
 * Rule 6 as every reader applies it (§3.2 edge cases, audit R28-C-M1 and its verification V1): the arrival complement
 * is merged into the end of stay while it is still to collect, or once both were settled together. Paid apart, or at
 * 0 €, the deferral marker merges nothing.
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
  endOfStaySettledApart,
  END_OF_STAY_CLEANING_LABEL,
};
