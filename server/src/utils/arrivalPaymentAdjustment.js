/**
 * What the guest ACTUALLY handed over for the single arrival payment, versus what the buckets add up
 * to (specs/arrival-payment-detail-and-adjustment.md §3.2).
 *
 * Below the computed total the difference is a **réduction accordée**, imputed on the accommodation;
 * above it, a **pourboire**. One target amount yields one or the other, never both.
 *
 * The floor is the rule that makes the réduction a réduction *on the accommodation*: it may eat the
 * « Hébergement » line whole and not a cent more, so the prestations and — above all — the taxe de
 * séjour, owed to the commune whatever the operator granted, keep their amounts. A target under the
 * floor is RAISED to it rather than refused: the operator's intent (« il a payé moins ») is honoured
 * as far as the books allow, and the field says how far that is.
 *
 * Pure — no DB, no clock. Unit-tested in tests/arrival-payment-adjustment.unit.test.js.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} input
 * @param {number} input.bucketsTotal  Σ of the amounts of the buckets the group settled.
 * @param {number} input.accommodation the accommodation share of those buckets — the réduction's ceiling.
 * @param {number|string|null|undefined} input.target what the operator says was handed over.
 *        `null` / `''` / `undefined` = no adjustment.
 * @returns {{reduction: number, tip: number, total: number, floor: number, floored: boolean}}
 */
function resolveArrivalPaymentAdjustment({ bucketsTotal, accommodation, target } = {}) {
  const buckets = round2(bucketsTotal);
  // A ceiling can never be more than the total it is a part of, nor negative — a corrupt snapshot
  // must not open the door to a réduction bigger than the payment.
  const ceiling = Math.min(Math.max(0, round2(accommodation)), Math.max(0, buckets));
  const floor = round2(Math.max(0, buckets - ceiling));

  const provided = target !== null && target !== undefined && target !== '';
  const asked = provided ? Number(target) : null;
  if (!provided || !Number.isFinite(asked)) {
    return { reduction: 0, tip: 0, total: buckets, floor, floored: false };
  }

  const wanted = round2(Math.max(0, asked));
  const total = Math.max(floor, wanted);
  return {
    reduction: round2(Math.max(0, buckets - total)),
    tip: round2(Math.max(0, total - buckets)),
    total: round2(total),
    floor,
    floored: total !== wanted,
  };
}

module.exports = { resolveArrivalPaymentAdjustment };
