/**
 * STEP inComplement — SETTLEMENT (specs/pricing-components.md §3 rule 52).
 *
 * Reads the lines routed to the arrival complement.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { readInComplement } = require('../settlement');

const step = {
  id: 'inComplement',
  requires: ['extraGuestComplementSurcharge', 'finalOptionLines', 'midStayForced', 'resourceLines'],
  provides: ['complementForcedItemsTotal', 'forcedItemsTotal'],
  apply(ctx) {
    const { extraGuestComplementSurcharge, finalOptionLines, midStayForced, resourceLines } = ctx;

    const { forcedItemsTotal, complementForcedItemsTotal } = readInComplement({
      finalOptionLines, resourceLines, extraGuestComplementSurcharge, midStayForced,
    });

    return { ...ctx, complementForcedItemsTotal, forcedItemsTotal };
  },
};

module.exports = step;
