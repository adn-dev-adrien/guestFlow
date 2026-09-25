/**
 * specs/platform-tourist-tax-out-of-the-commission.md rules 4 + 21 — should the « Taxe de séjour
 * retenue » box be seeded with the engine's figure?
 *
 * Pure decision, kept out of ReservationPage so it can be pinned on its own. It answers yes only for
 * a fiche whose brut (« Montant total payé par le client ») has not been entered yet, whose box is
 * still empty, on a platform that collects the tax and remits it to the commune itself.
 *
 * Rule 21 is why the test is the brut and not the fiche's age: an iCal-imported booking IS saved —
 * it lands in the database before anyone opens it — and Booking, Airbnb and Gîtes de France all
 * arrive that way, so a « never saved » test never fired on the very fiches a statement is copied
 * into. A brand-new fiche has no brut either, so rule 4 is the special case of this one.
 *
 * Everything else is left alone, which is what protects the reservations stored before this feature:
 * an empty box on a fiche that already carries a brut means « the brut is tax-excluded » (rules 2,
 * 22), and re-seeding it would silently change that reservation's revenue.
 *
 * Once the box holds anything — an explicit 0 included (rule 15) — the platform's number is the
 * operator's and nothing rewrites it, however the party or the dates then move.
 *
 * @param {object}  args
 * @param {boolean} args.grossEntered    true when the brut already carries a value.
 * @param {*}       args.currentValue    what the box currently holds ('' when empty).
 * @param {object}  args.quote           the engine quote.
 * @returns {number|null} the amount to seed, or null to leave the box untouched.
 */
export function resolvePlatformTouristTaxPrefill({ grossEntered, currentValue, quote }) {
  if (grossEntered) return null;
  if (currentValue !== '' && currentValue != null) return null;
  if (!quote || !quote.touristTaxOfferedByPlatform) return null;
  const estimate = Number(quote.touristTaxOriginalTotal);
  if (!Number.isFinite(estimate) || estimate <= 0) return null;
  return estimate;
}

export default resolvePlatformTouristTaxPrefill;
