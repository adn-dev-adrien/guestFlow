/**
 * STEP totals — TOTALS (specs/pricing-components.md §3 rule 52).
 *
 * Aggregates the final price, the discount amount and the stay total; computes nothing.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { aggregateTotals } = require('../totals');

const step = {
  id: 'totals',
  requires: [
    'accommodationAdjustedPrice', 'extraGuestSurcharge', 'familyVat', 'optionsTotal', 'resourcesTotal', 'subtotal',
    'touristTaxTotal',
  ],
  provides: ['discountAmount', 'finalPrice', 'totalStayPrice'],
  apply(ctx) {
    const {
      accommodationAdjustedPrice, extraGuestSurcharge, familyVat, optionsTotal, resourcesTotal, subtotal,
      touristTaxTotal,
    } = ctx;

    const totals = aggregateTotals({
      accommodation: accommodationAdjustedPrice,
      extraGuestSurcharge,
      optionsTotal,
      resourcesTotal,
      touristTaxTotal,
      subtotal,
      vat: familyVat,
    });
    const { finalPrice, discountAmount, totalStayPrice } = totals;

    return { ...ctx, discountAmount, finalPrice, totalStayPrice };
  },
};

module.exports = step;
