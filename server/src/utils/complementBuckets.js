/**
 * Complements ranked by the MOMENT they are collected — specs/complement-buckets-by-moment.md.
 *
 * The database stores complements by bucket of origin (`complementAmount` = arrival,
 * `endOfStayComplementAmount` = check-out, settled notes = during the stay). What the operator reads
 * on the fiche is a different question: *when* is this money taken? An arrival complement left
 * unsettled at check-in — deferred on purpose or simply not answered — is collected at the door with
 * the end-of-stay one, so that is where it belongs on screen.
 *
 * Pure: no DB, no clock (the caller resolves `stayStarted`). The split never changes a total —
 * `arrival + duringStay + endOfStay` always equals what the three inputs sum to (rule 6).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} params
 * @param {number} params.complementAmount         arrival complement (stored).
 * @param {number|boolean} params.complementPaid   collected at check-in.
 * @param {number} params.midStaySettledTotal      sold during the stay AND collected (notes).
 * @param {number} params.endOfStayComplementTotal SAS lines + mid-stay remainder.
 * @param {boolean} params.stayStarted             `startDate <= today`; false for a devis / quote.
 * @param {boolean} params.deferred                the operator moved the arrival complement to the
 *                 door on purpose (`complementDeferredToCheckout`). Files it under « fin de séjour »
 *                 straight away, without waiting for the stay to start
 *                 (specs/defer-arrival-complement-to-checkout.md §3.3 rule 16) — otherwise the fiche
 *                 would show one merged card while the summary panel still billed it to the arrival.
 * @returns {{ arrival: number, duringStay: number, endOfStay: number }}
 */
function splitComplementBuckets({
  complementAmount, complementPaid, midStaySettledTotal, endOfStayComplementTotal, stayStarted, deferred,
} = {}) {
  const arrival = round2(complementAmount);
  const endOfStay = round2(endOfStayComplementTotal);
  // Before the guest is in, the arrival complement is a forecast of what will be taken at check-in.
  // Once the stay has started — or as soon as the operator deferred it on purpose — it stays there
  // only if it was actually collected.
  const collectedAtArrival = Number(complementPaid || 0) === 1
    || (!stayStarted && !deferred);
  return {
    arrival: collectedAtArrival ? arrival : 0,
    duringStay: round2(midStaySettledTotal),
    endOfStay: collectedAtArrival ? endOfStay : round2(endOfStay + arrival),
  };
}

module.exports = { splitComplementBuckets };
