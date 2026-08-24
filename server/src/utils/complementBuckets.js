/**
 * Complements ranked by the MOMENT they are collected — specs/complement-buckets-by-moment.md.
 *
 * The database stores complements by bucket of origin (`complementAmount` = arrival,
 * `endOfStayComplementAmount` = check-out, settled notes = during the stay). What the operator reads
 * on the fiche is a different question: *when* is this money taken? That question has exactly one
 * answer, and it is the operator's: the « Percevoir en fin de séjour » marker
 * (specs/defer-arrival-complement-to-checkout.md §3.3).
 *
 * It used to be inferred instead — « the stay has started and nobody collected, so it will be taken
 * at the door ». The inference was right in the common case and infuriating in every other: it moved
 * the money between headings on its own, on the arrival day, and there was no way to put it back
 * (arbitré avec Adrien le 2026-08-22). The day-of-operations alerts keep that reading, because
 * « what is still to collect today » really is a matter of fact — see utils/operationalCollection.js.
 *
 * Pure: no DB, no clock. The split never changes a total — `arrival + duringStay + endOfStay` always
 * equals what the three inputs sum to (rule 6).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} params
 * @param {number} params.complementAmount         arrival complement (stored).
 * @param {number|boolean} params.complementPaid   collected at check-in.
 * @param {number} params.midStaySettledTotal      sold during the stay AND collected (notes).
 * @param {number} params.endOfStayComplementTotal SAS lines + mid-stay remainder.
 * @param {boolean} params.deferred                the operator moved the arrival complement to the
 *                 door (`complementDeferredToCheckout`).
 * @returns {{ arrival: number, duringStay: number, endOfStay: number }}
 */
function splitComplementBuckets({
  complementAmount, complementPaid, midStaySettledTotal, endOfStayComplementTotal, deferred,
} = {}) {
  const arrival = round2(complementAmount);
  const endOfStay = round2(endOfStayComplementTotal);
  // Money already in the till was collected at check-in, whatever the marker says afterwards.
  const collectedAtArrival = Number(complementPaid || 0) === 1 || !deferred;
  return {
    arrival: collectedAtArrival ? arrival : 0,
    duringStay: round2(midStaySettledTotal),
    endOfStay: collectedAtArrival ? endOfStay : round2(endOfStay + arrival),
  };
}

module.exports = { splitComplementBuckets };
