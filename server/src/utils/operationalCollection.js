/**
 * Day-of-operations collection status (specs/dashboard-collection-alert.md).
 *
 * The dashboard used to paint its « Paiements » cell red whenever `computePaymentStatus` reported
 * anything outstanding. That flag nets only the acompte + solde out of `finalPrice`, so a platform
 * booking — which pays a single transfer AFTER the stay — was red every single day for a perfectly
 * normal situation, and the operator learned to ignore the column.
 *
 * What actually deserves an alert is the money the operator collects AT THE DOOR and hasn't:
 *   - on the arrivals list, the arrival complement, unless it was consciously deferred to check-out
 *     (specs/defer-arrival-complement-to-checkout.md);
 *   - on the departures list, the merged « complément de fin de séjour » = whatever is left of the
 *     arrival complement + the end-of-stay extras.
 * An unpaid acompte / solde is never an alert here, whatever the platform — chasing a late direct
 * balance is the Finances page's job (specs/finance-operational-remaining-to-pay.md).
 *
 * Returns a ready-to-render block: the client maps states to colors and formats the currency, and
 * decides nothing. Pure — unit-tested in tests/operational-collection.unit.test.js.
 */

const { bucketStates, isSettled, round2 } = require('./reservationSettlement');

const bucketState = (b) => (b.settled ? 'ok' : 'pending');

/**
 * @param {object} reservation         detailed reservation row (the shape of getByIdWithDetails).
 * @param {object} [checkoutComplement] the block built by utils/checkoutComplement.js — used for its
 *                 normalised `deferred` flag (a deferred complement that got paid is no longer
 *                 deferred). Derived from the raw column when absent.
 * @returns {{arrival:object, departure:object, platformSettled:boolean, platform:(string|null)}}
 */
function buildOperationalCollection(reservation = {}, checkoutComplement = null) {
  const b = bucketStates(reservation);
  const settled = isSettled(reservation);

  const arrivalDue = b.complement.applicable && !b.complement.settled ? b.complement.amount : 0;
  const endOfStayDue = b.endOfStay.applicable && !b.endOfStay.settled ? b.endOfStay.amount : 0;
  const deferred = checkoutComplement
    ? Boolean(checkoutComplement.deferred)
    : (Number(reservation.complementDeferredToCheckout || 0) === 1 && arrivalDue > 0);

  // The two échéances the platform settles for us. Both sides of the block share them.
  const echeances = [
    { key: 'deposit', label: 'Acompte', bucket: b.deposit },
    { key: 'balance', label: 'Solde', bucket: b.balance },
  ];
  const parts = (complementPart) => [
    ...echeances.filter((e) => e.bucket.applicable).map((e) => ({
      key: e.key, label: e.label, state: bucketState(e.bucket),
    })),
    ...(complementPart ? [complementPart] : []),
  ];

  const arrivalComplementPart = b.complement.applicable
    ? { key: 'complement', label: 'Complément', state: deferred ? 'deferred' : bucketState(b.complement) }
    : null;
  // At check-out the two complement buckets are collected as one (specs/defer-arrival-complement-to-checkout.md
  // §3.2) — one part, settled only when nothing is left of either.
  const departureDue = round2(arrivalDue + endOfStayDue);
  const departureComplementPart = (b.complement.applicable || b.endOfStay.applicable)
    ? { key: 'complement', label: 'Complément', state: departureDue > 0 ? 'pending' : 'ok' }
    : null;

  const platform = String(reservation.platform || 'direct').toLowerCase() === 'direct'
    ? null
    : reservation.platform;
  const awaitingEcheance = echeances.some((e) => e.bucket.applicable && !e.bucket.settled);

  return {
    arrival: {
      alert: arrivalDue > 0 && !deferred,
      settled,
      amountDue: deferred ? 0 : arrivalDue,
      deferred,
      parts: parts(arrivalComplementPart),
    },
    departure: {
      alert: departureDue > 0,
      settled,
      amountDue: departureDue,
      deferred,
      parts: parts(departureComplementPart),
    },
    platformSettled: Boolean(platform) && awaitingEcheance,
    platform,
  };
}

module.exports = { buildOperationalCollection };
