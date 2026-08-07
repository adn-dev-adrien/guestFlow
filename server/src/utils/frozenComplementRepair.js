/**
 * Frozen arrival complement inflated by a later mid-stay sale — specs/frozen-complement-trusts-client.md.
 *
 * Once `complementPaid = 1` the arrival complement is frozen: the engine returns the amount it is
 * given instead of recomputing it (pricing.js). That input used to come from the request body, i.e.
 * from a quote computed in the browser — and a quote computed WITHOUT the mid-stay baseline puts a
 * sale made during the stay back into the arrival complement. The reservation then carried the same
 * service twice: once in the frozen `complementAmount`, once in the end-of-stay complement, and the
 * accounting credited it twice.
 *
 * The write path now feeds the STORED amount to the engine; this helper repairs the rows that were
 * already inflated, by subtracting the forced mid-stay part the end-of-stay complement already bills.
 *
 * Pure: no DB, no clock.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} params
 * @param {number} params.complementAmount  stored arrival complement.
 * @param {number|boolean} params.complementPaid  frozen when truthy.
 * @param {number} params.midStayForced  Σ of the mid-stay lines routed to the complement
 *                                       (`resolveMidStaySplit(...).forced`).
 * @returns {{ amount: number, floored: boolean }|null} `null` when there is nothing to correct.
 */
function repairFrozenComplement({ complementAmount, complementPaid, midStayForced } = {}) {
  if (Number(complementPaid || 0) !== 1) return null;
  const forced = round2(midStayForced);
  if (forced <= 0) return null;
  const stored = round2(complementAmount);
  const corrected = round2(stored - forced);
  if (corrected === stored) return null;
  return { amount: Math.max(0, corrected), floored: corrected < 0 };
}

module.exports = { repairFrozenComplement };
