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

/**
 * @param {object} reservation      row/payload carrying the complement columns.
 * @param {object} arrivalDetail    `{ amount, paid, detail[] }` from `buildArrivalComplementDetail`.
 * @returns {{ deferred: boolean, amount: number, arrivalAmount: number, endOfStayAmount: number,
 *            paid: boolean, paidCash: boolean, paidDate: string|null, lines: object[] }}
 */
function buildCheckoutComplement(reservation, arrivalDetail) {
  const r = reservation || {};
  const arrivalAmount = round2(arrivalDetail ? arrivalDetail.amount : r.complementAmount);
  const endOfStayAmount = round2(r.endOfStayComplementAmount);
  // Deferred only while the arrival complement is actually still to collect: once it is paid, the two
  // collections really happened at two different moments and keep their own cards (§3.2 edge cases).
  const deferred = Number(r.complementDeferredToCheckout || 0) === 1
    && Number(r.complementPaid || 0) !== 1
    && arrivalAmount > 0;

  const lines = [
    ...((arrivalDetail && arrivalDetail.detail) || []).map((l) => ({
      label: l.label,
      qty: Number(l.qty || 1),
      unitPrice: round2(l.unitPrice),
      amount: round2(l.amount),
      origin: 'arrival',
    })),
    ...parseDetail(r.endOfStayComplementDetail).map((l) => ({
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

module.exports = { buildCheckoutComplement, END_OF_STAY_CLEANING_LABEL };
