/**
 * « Rien à percevoir » — is there nothing to collect at the door before this SAS run adds anything
 * (specs/ui-review-2026-10-19-operations.md rule 4)? Decided here, from the stored buckets, so the
 * recap never shows a green badge over money still owed:
 *
 *   - the stay itself, on a DIRECT channel (a platform solde is the OTA's payout, never door money):
 *     an unsettled acompte or solde — at departure too, where a stay deferred at check-in is still owed;
 *   - the arrival complement, unsettled;
 *   - at departure, the end-of-stay complement already stored and unsettled.
 *
 * The caution is not money collected on the recap: the dialog hides the badge itself while the
 * caution is deferred. What the run adds at the door (a ménage, linen) is then the recap's own total.
 *
 * Pure apart from the two core helpers it is given.
 */
function nothingToCollect(reservation, { isDeparture = false, bucketStates, isDirectChannel }) {
  if (!reservation) return false;
  const b = bucketStates(reservation);
  const owed = (bucket) => bucket.applicable && !bucket.settled;
  const stayOwed = isDirectChannel(reservation.platform) && (owed(b.deposit) || owed(b.balance));
  const complementOwed = owed(b.complement);
  const endOfStayOwed = isDeparture && owed(b.endOfStay);
  return !stayOwed && !complementOwed && !endOfStayOwed;
}

module.exports = { nothingToCollect };
