/**
 * STEP settlement — SETTLEMENT (specs/pricing-components.md §3 rule 52).
 *
 * The complement's detail lines and its split by moment.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { planSettlement } = require('../settlement');

const step = {
  id: 'settlement',
  requires: [
    'complementCollected', 'complementDeferredToCheckout', 'complementPaid', 'endOfStayComplementTotal',
    'extraGuestComplementCount', 'extraGuestComplementSurcharge', 'finalOptionLines',
    'isTouristTaxCollectedOnArrival', 'isTouristTaxForcedToComplement', 'midStayExtras', 'midStaySettledAll',
    'resolvedComplementAmount', 'resourceLines', 'taxInComplement',
  ],
  provides: ['complementDetailLines', 'complementSplit'],
  apply(ctx) {
    const {
      complementCollected, complementDeferredToCheckout, complementPaid, endOfStayComplementTotal,
      extraGuestComplementCount, extraGuestComplementSurcharge, finalOptionLines,
      isTouristTaxCollectedOnArrival, isTouristTaxForcedToComplement, midStayExtras, midStaySettledAll,
      resolvedComplementAmount, resourceLines, taxInComplement,
    } = ctx;

    const { complementDetailLines, complementSplit } = planSettlement({
      lines: {
        finalOptionLines, resourceLines, midStayExtras, extraGuestComplementSurcharge, extraGuestComplementCount,
      },
      stayLevel: {
        resolvedComplementAmount, taxInComplement, isTouristTaxCollectedOnArrival, isTouristTaxForcedToComplement,
        midStaySettledAll, endOfStayComplementTotal,
      },
      receipts: { complementPaid, complementCollected, complementDeferredToCheckout },
    });

    return { ...ctx, complementDetailLines, complementSplit };
  },
};

module.exports = step;
