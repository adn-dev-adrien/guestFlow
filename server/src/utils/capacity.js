/**
 * Property guest-capacity rule (specs/property-capacity-single-total.md §3).
 *
 * Pure function — no DB access. THE single definition of "does this occupancy fit?", consumed by
 * the back-office controller (warning + `forceCapacity` escape hatch) and by the public
 * booking-request controller (hard 409). The reservation form mirrors it client-side for the inline
 * warning only; this module stays the authority.
 *
 * Model — one total + a separate baby allowance:
 *   guests = adults + children + teens      (everyone over 2 years old)   ≤ maxGuests
 *   babies                                  (0-2 years old)               ≤ maxBabies
 *
 * Babies never consume a `maxGuests` slot: the pricing engine already bills
 * `persons = adults + children + teens` (utils/pricing.js), so capacity and price agree on who
 * counts as a guest. A child sleeping in a baby bed still consumes a slot (§3 rule 5) — `maxGuests`
 * counts people, not beds; the bed-side nuance lives in the bed-linen / baby-bed checks.
 *
 * The two zeros are NOT symmetric:
 *   maxGuests = 0 → capacity not configured yet → the guest guard is off (a half-configured property
 *                   must never be unbookable — that is the bug this model replaces).
 *   maxBabies = 0 → an explicit "no babies accepted" allowance (no cot), enforced as before.
 */

function toCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {{ maxGuests?: number, maxBabies?: number }} property
 * @param {{ adults?: number, children?: number, teens?: number, babies?: number }} occupancy
 * @returns {null | { parts: Array<{ kind: 'guests'|'babies', count: number, max: number }>, message: string }}
 *          null when the occupancy fits.
 */
function checkGuestCapacity(property = {}, occupancy = {}) {
  const maxGuests = toCount(property.maxGuests);
  const maxBabies = toCount(property.maxBabies);

  // A missing/zero `adults` still counts as one guest — a stay always has at least its booker
  // (same tolerance as the pre-2026-08 bucket check).
  const guests = Math.max(1, toCount(occupancy.adults)) + toCount(occupancy.children) + toCount(occupancy.teens);
  const babies = toCount(occupancy.babies);

  const parts = [];
  if (maxGuests > 0 && guests > maxGuests) parts.push({ kind: 'guests', count: guests, max: maxGuests });
  if (babies > maxBabies) parts.push({ kind: 'babies', count: babies, max: maxBabies });
  if (!parts.length) return null;

  const label = (p) => (p.kind === 'guests' ? `voyageurs: ${p.count}/${p.max}` : `bébés: ${p.count}/${p.max}`);
  return {
    parts,
    message: `Le nombre de personnes dépasse la capacité du logement (${parts.map(label).join(' • ')}).`,
  };
}

module.exports = { checkGuestCapacity };
