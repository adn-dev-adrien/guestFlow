/**
 * Pure resolver for what the arrival SAS must write on ONE stay bucket (acompte or solde) when the
 * guest settles the stay at the door — specs/collect-stay-payment-at-check-in.md §3.3.
 *
 * The SAS only ever owns what it collected itself: the `*PaidAtArrival` marker is what tells a
 * re-opened SAS which buckets its own « Pas maintenant » may undo, and what protects an acompte
 * wired by bank transfer from being cleared by a check-in gesture.
 *
 * Rules:
 *   - `stayPaid === undefined` (the step never ran) → leave the bucket exactly as it is;
 *   - settling only touches an APPLICABLE bucket, and never re-stamps one that was already paid
 *     OUTSIDE the SAS (no marker) — its date and its caisse-interne flag stay the operator's;
 *   - the paid date is kept when there was one, else today: a re-commit must not move the money;
 *   - « Pas maintenant » reverts the buckets THIS SAS settled, and only those.
 *
 * No DB, no clock: `today` is injected. Unit-tested in tests/stay-payment-resolve.unit.test.js.
 */

/**
 * @param {object}  input
 * @param {object}  input.bucket   `{ applicable, settled }` from `bucketStates()`
 * @param {object}  input.prev     stored state `{ paid, cash, date, atArrival }`
 * @param {boolean|undefined} input.stayPaid      the recap's answer, tri-state
 * @param {boolean} input.stayPaidCash            « Payé en liquide » (caisse interne)
 * @param {string}  input.today                   YYYY-MM-DD
 * @returns {null|{paid:0|1, cash:0|1, date:string|null, atArrival:0|1}} `null` = write nothing.
 */
function resolveStayPayment({
  bucket = {}, prev = {}, stayPaid, stayPaidCash = false, today = null,
} = {}) {
  if (stayPaid === undefined) return null;
  const wasAtArrival = Number(prev.atArrival || 0) === 1;

  if (!stayPaid) {
    // « Pas maintenant » — undo our own gesture, never someone else's payment.
    if (!wasAtArrival) return null;
    return { paid: 0, cash: 0, date: null, atArrival: 0 };
  }

  if (!bucket.applicable) return null;
  // Already collected before the check-in (virement, lien de paiement…): not ours to re-stamp.
  if (bucket.settled && !wasAtArrival) return null;

  return {
    paid: 1,
    cash: stayPaidCash ? 1 : 0,
    date: prev.date || today,
    atArrival: 1,
  };
}

module.exports = { resolveStayPayment };
