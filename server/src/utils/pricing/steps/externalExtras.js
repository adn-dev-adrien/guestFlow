/**
 * STEP extras (external) — prices the requested articles for a customer with no stay (specs/pricing-components.md §3 rules 52, 53).
 *
 * The ARTICLES head is asked with `customerContext = 'external'`: the same families, no stay context (no persons, no nights, no free
 * units), and a family that reads the stay answers `NEEDS_STAY`. `quoted[i]` answers `requests[i]` (null when refused); `refusals` are
 * the head's, each `{ ref, code, message }`.
 */
const articles = require('../articles');

// A sale with no stay has nobody to count, no nights and no free units to spend.
const NO_STAY = Object.freeze({ persons: 1, nights: 1, maxGuests: 0, isDirectBooking: true });
const NO_FREE_UNITS = Object.freeze({ grantedFreeUnitsFor: () => 0, consumedFreeUnitsFor: () => 0 });

const step = {
  id: 'externalExtras',
  requires: ['requests', 'families'],
  provides: ['quoted', 'refusals'],
  apply(ctx) {
    const result = articles.quote({
      requests: ctx.requests.map((request) => ({ portions: () => ({ quantity: request.quantity, clampedFrom: null }), ...request })),
      stayContext: NO_STAY,
      customerContext: 'external',
      allowance: NO_FREE_UNITS,
      families: ctx.families,
    });
    return { ...ctx, quoted: result.lines, refusals: result.refusals };
  },
};

module.exports = step;
