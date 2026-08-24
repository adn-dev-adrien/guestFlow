/**
 * When did the arrival actually happen? — specs/arrival-moment-is-the-check-in.md
 *
 * Several rules hinge on « the guest is in »: which complement an extra joins, and which heading an
 * unsettled complement reads under. They all used to test the CALENDAR (`startDate <= today`), which
 * is a different question. On the arrival day, before anyone has checked in, an option added by hand
 * was filed as « sold during the stay » and billed at check-out instead of at arrival.
 *
 * The arrival is an operator act — the check-in box, or the arrival SAS which sets its own timestamp.
 * Both are kept: the two flows are used side by side (24 and 17 stays respectively on the operator's
 * base), and either one means the guest is standing there.
 */

// The guest is in: the check-in was marked, or the arrival SAS was completed.
function hasGuestArrived(reservation) {
  const r = reservation || {};
  return Number(r.checkInDone || 0) === 1 || Boolean(r.arrivalSasDoneAt);
}

/**
 * Should the arrival extras baseline be pinned now? — the arrival, plus one safety valve: once the
 * arrival complement is COLLECTED its amount is frozen, so a later sale can no longer join it. Without
 * a baseline to stand above, that sale would reach no bucket at all and its money would vanish
 * (specs/sas-breakfast-and-catering-upsell.md §3.4). Pinning on collection keeps that impossible even
 * when the operator never marked the check-in.
 */
function arrivalBaselineDue(reservation) {
  const r = reservation || {};
  return hasGuestArrived(r) || Number(r.complementPaid || 0) === 1;
}

module.exports = { hasGuestArrived, arrivalBaselineDue };
