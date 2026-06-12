/**
 * Bed-linen adequacy check for the planning arrival cards
 * (specs/planning-arrival-alerts.md §3 rule 6).
 *
 * Pure function — no DB access. Mirrors the capacity formula already used live in the
 * reservation form (ReservationPage `bedsCapacityMismatch`) so the planning surfaces the SAME
 * verdict on a saved reservation, computed server-side (fat backend).
 *
 * Returns one of:
 *   - null                              → no alert (linen is fine, or the property provides linen
 *                                          by default so the operator doesn't manage it per stay).
 *   - { type: 'no_linen' }              → the guest did NOT take the bed-linen option.
 *   - { type: 'capacity', capacity, required }
 *                                       → linen taken, but the bed configuration sleeps fewer
 *                                          people than the booking has (capacity < required).
 *
 * Capacity model (identical to the form):
 *   capacity = singleBeds + doubleBeds × 2
 *   required = adults + teens + children NOT sleeping in a baby bed
 *   childrenInBabyBeds = max(0, babyBeds − babies)   (baby beds beyond the babies host children)
 */
function computeBedLinenAlert({ reservation, options = [], bedLinenProvidedByDefault = false }) {
  // Properties that include bed linen by default are not managed per-stay → never alert.
  if (bedLinenProvidedByDefault) return null;

  const r = reservation || {};
  const hasBedLinenOption = (options || []).some((o) => o && o.autoOptionType === 'bed_linen');
  if (!hasBedLinenOption) return { type: 'no_linen' };

  const adults = Math.max(0, Number(r.adults || 0));
  const teens = Math.max(0, Number(r.teens || 0));
  const children = Math.max(0, Number(r.children || 0));
  const babies = Math.max(0, Number(r.babies || 0));
  const babyBeds = Math.max(0, Number(r.babyBeds || 0));

  const childrenInBabyBeds = Math.max(0, babyBeds - babies);
  const childrenInRegularBeds = Math.max(0, children - childrenInBabyBeds);
  const required = adults + teens + childrenInRegularBeds;
  const capacity = Math.max(0, Number(r.singleBeds || 0)) + Math.max(0, Number(r.doubleBeds || 0)) * 2;

  if (capacity < required) return { type: 'capacity', capacity, required };
  return null;
}

module.exports = { computeBedLinenAlert };
