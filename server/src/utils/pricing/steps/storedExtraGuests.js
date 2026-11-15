/**
 * STEP storedExtraGuests — EXTRA GUESTS as stored, for a sale (specs/pricing-components.md §3 rule 8).
 *
 * A sale on a stay reads the extra-guest supplement the stay was priced with (`reservations.storedExtraGuests`, its share
 * inside a platform price included) instead of running EXTRA GUESTS: no tariff, season or extra-guest setting is read. A
 * stay with no record, or whose record was computed on other inputs of the stay (`storedSaleFigures.extraGuestsBasis`), is
 * priced by EXTRA GUESTS as before. It provides the keys of the `extraGuests` step.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */
const extraGuests = require('./extraGuests');
const { extraGuestsBasis, matchingRecord } = require('../storedSaleFigures');

const step = {
  id: 'storedExtraGuests',
  requires: [...extraGuests.requires, 'startDate', 'endDate', 'storedSaleFigures'],
  provides: extraGuests.provides,
  apply(ctx) {
    const figures = matchingRecord(ctx.storedSaleFigures, 'extraGuests', extraGuestsBasis(ctx));
    return figures ? { ...ctx, ...figures } : extraGuests.apply(ctx);
  },
};

module.exports = step;
