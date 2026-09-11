/**
 * specs/platform-tourist-tax-out-of-the-commission.md rule 4 — should the « Taxe de séjour retenue »
 * box be seeded with the engine's figure?
 *
 * Pure decision, kept out of ReservationPage so it can be pinned on its own. It answers yes only for
 * a fiche that has NEVER been saved, whose box is still empty, on a platform that collects the tax
 * and remits it to the commune itself. Everything else is left alone, which is what protects the
 * reservations stored before this feature: an empty box on a saved fiche means « the brut is
 * tax-excluded » (rule 2), and re-seeding it would silently change their revenue.
 *
 * Once the box holds anything — an explicit 0 included (rule 15) — the platform's number is the
 * operator's and nothing rewrites it, however the party or the dates then move.
 *
 * @param {object}  args
 * @param {boolean} args.isNewFiche      true when neither a reservation nor a devis is being edited.
 * @param {*}       args.currentValue    what the box currently holds ('' when empty).
 * @param {object}  args.quote           the engine quote.
 * @returns {number|null} the amount to seed, or null to leave the box untouched.
 */
export function resolvePlatformTouristTaxPrefill({ isNewFiche, currentValue, quote }) {
  if (!isNewFiche) return null;
  if (currentValue !== '' && currentValue != null) return null;
  if (!quote || !quote.touristTaxOfferedByPlatform) return null;
  const estimate = Number(quote.touristTaxOriginalTotal);
  if (!Number.isFinite(estimate) || estimate <= 0) return null;
  return estimate;
}

export default resolvePlatformTouristTaxPrefill;
