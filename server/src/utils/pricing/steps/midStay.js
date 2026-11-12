/**
 * STEP midStay — SETTLEMENT (specs/pricing-components.md §3 rule 52).
 *
 * Splits the extras sold during the stay from the pre-arrival ones and sums the accommodation base and the
 * subtotal.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { resolveMidStaySplit } = require('../settlement');

const step = {
  id: 'midStay',
  requires: [
    'endOfStayComplementSettled', 'extraGuestSurcharge', 'finalOptionLines', 'frozenMidStayLines',
    'midStaySettledNotes', 'optionsTotal', 'resourceLines', 'resourcesTotal', 'totalPrice', 'clock', 'extrasDiscountCents',
    'accommodationDiscountShareCents',
  ],
  provides: [
    'accommodationBaseTotal', 'midStayExtras', 'midStayForced', 'midStayRemainingTotal', 'midStaySettledTotal',
    'midStayTotal', 'midStayUnforced', 'subtotal',
  ],
  apply(ctx) {
    const {
      endOfStayComplementSettled, extraGuestSurcharge, finalOptionLines, frozenMidStayLines,
      midStaySettledNotes, optionsTotal, resourceLines, resourcesTotal, totalPrice, extrasDiscountCents,
    } = ctx;
    const { arrivalExtrasBaseline } = ctx.clock;

    // specs/mid-stay-extras-to-end-of-stay-complement.md §3.2-§3.3 — what exceeds the arrival baseline
    // was sold DURING the stay: it belongs to the end-of-stay complement, so it is pulled out of the
    // pre-arrival split (`midStayUnforced`) and out of the arrival complement (`midStayForced`) below.
    // Once that complement is collected the split is frozen on the STORED lines: the collected money
    // still has to be carved out of the other buckets, but it is never re-priced.
    const midStayExtras = resolveMidStaySplit([...finalOptionLines, ...resourceLines], {
      baseline: arrivalExtrasBaseline,
      settled: endOfStayComplementSettled,
      storedLines: frozenMidStayLines,
      notes: midStaySettledNotes,
    });
    // `midStayTotal` = everything sold during the stay → what leaves the frozen buckets. It splits in
    // two: what the notes already collected, and the remainder still due at check-out.
    const midStayTotal = roundMoney(midStayExtras.total);
    const midStayForced = roundMoney(midStayExtras.forced);
    const midStayUnforced = roundMoney(midStayExtras.unforced);
    const midStaySettledTotal = roundMoney(midStayExtras.settledTotal);
    const midStayRemainingTotal = roundMoney(midStayExtras.remainingTotal);
    const accommodationBaseTotal = roundMoney(Number(totalPrice || 0));
    // The subtotal is what the stay would cost before any discount: the extras' discount (rules 39, 40) comes back in.
    const subtotal = roundMoney(accommodationBaseTotal + extraGuestSurcharge + optionsTotal + resourcesTotal + extrasDiscountCents / 100);

    return {
      ...ctx,
      accommodationBaseTotal, midStayExtras, midStayForced, midStayRemainingTotal, midStaySettledTotal,
      midStayTotal, midStayUnforced, subtotal,
    };
  },
};

module.exports = step;
