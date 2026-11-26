/**
 * STEP storedTouristTax — TOURIST TAX as stored, for a sale (specs/pricing/pricing-components.md §3 rule 8).
 *
 * A sale on a stay reads the tax the stay was priced with (`reservations.storedTouristTax`: the total, its detail — base,
 * rate, unit amount —, where it is collected, the added guests' part) instead of running TOURIST TAX: no tax setting nor
 * platform tax mode is read. A stay with no record, or whose record was computed on other inputs of the stay
 * (`storedSaleFigures.touristTaxBasis`: the party, the nights' price, the platform price, the frozen tax, the lines the base
 * reads), is priced by TOURIST TAX as before. It provides the keys of the `touristTax` step.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */
const touristTax = require('./touristTax');
const { touristTaxBasis, matchingRecord } = require('../storedSaleFigures');

const step = {
  id: 'storedTouristTax',
  requires: [...touristTax.requires, 'startDate', 'endDate', 'storedSaleFigures'],
  provides: touristTax.provides,
  apply(ctx) {
    const figures = matchingRecord(ctx.storedSaleFigures, 'touristTax', touristTaxBasis(ctx));
    // A record written before the tax gap existed (4.5.x) holds none: no gap, as when it was priced.
    return figures ? { ...ctx, touristTaxGap: 0, ...figures } : touristTax.apply(ctx);
  },
};

module.exports = step;
