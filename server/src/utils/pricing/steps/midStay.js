/**
 * STEP midStay — SETTLEMENT (specs/pricing-components.md §3 rule 52).
 *
 * Splits the extras sold during the stay from the pre-arrival ones and sums the accommodation base and the
 * subtotal.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { resolveMidStaySplit, baselineWithDerivedLines } = require('../settlement');

const step = {
  id: 'midStay',
  requires: [
    'endOfStayComplementSettled', 'extraGuestSurcharge', 'finalOptionLines', 'frozenMidStayLines',
    'midStaySettledNotes', 'optionsTotal', 'resourceLines', 'resourcesTotal', 'totalPrice', 'clock', 'extrasDiscountCents',
    'accommodationDiscountShareCents', 'bookingId', 'lockedOptionLines',
  ],
  provides: [
    'accommodationBaseTotal', 'midStayExtras', 'midStayForced', 'midStayRemainingTotal', 'midStaySettledTotal',
    'midStayTotal', 'midStayUnforced', 'subtotal',
  ],
  apply(ctx) {
    const {
      endOfStayComplementSettled, extraGuestSurcharge, finalOptionLines, frozenMidStayLines,
      midStaySettledNotes, optionsTotal, resourceLines, resourcesTotal, totalPrice, extrasDiscountCents,
      bookingId, lockedOptionLines,
    } = ctx;
    // Rule 82: on a stored stay, a line the arrival never priced is not a sale made during the stay: an automatic option its lines never
    // stored (derived from the stay's own times) and a catalogue line stored with neither a unit price nor a total (a fresh one; a free unit keeps its unit price) belong to the arrival.
    // Rule 85: a later sale of an article names itself (`lineId`) and reads its own stored line; the first one reads the article's first.
    const storedLines = Array.isArray(lockedOptionLines) ? lockedOptionLines : [];
    const storedByOption = new Map();
    for (const stored of storedLines) {
      const held = storedByOption.get(Number(stored.optionId));
      if (!held || (stored.lineId != null && (held.lineId == null || Number(stored.lineId) < Number(held.lineId)))) storedByOption.set(Number(stored.optionId), stored);
    }
    const storedByLine = new Map(storedLines.filter((stored) => stored.lineId != null).map((stored) => [Number(stored.lineId), stored]));
    const unpricedAtArrival = (line) => {
      if (!line || line.isCustom || line.optionId == null) return false;
      const stored = (line.lineId != null && storedByLine.get(Number(line.lineId))) || storedByOption.get(Number(line.optionId));
      if (!stored) return Boolean(line.autoOptionType);
      return Number(stored.totalPrice || 0) <= 0 && Number(stored.unitPrice || 0) <= 0 && Number(stored.offered || 0) !== 1;
    };
    const arrivalExtrasBaseline = Number(bookingId || 0) > 0
      ? baselineWithDerivedLines(ctx.clock.arrivalExtrasBaseline, finalOptionLines.filter(unpricedAtArrival))
      : ctx.clock.arrivalExtrasBaseline;

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
