/**
 * STEP nights — NIGHTS (specs/pricing-components.md §3 rule 52).
 *
 * Prices the nights of the stay (locked nights replayed), refuses a stay with none, and checks the changeover
 * days.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { mergeNightlyBreakdownWithLocked, calculateBaseStayPrice } = require('../nights');
const { checkChangeover } = require('../../changeover');

const step = {
  id: 'nights',
  requires: ['endDate', 'lockedNightlyBreakdown', 'rules', 'startDate'],
  provides: [
    'baseAccommodationPrice', 'changeover', 'freshUnpricedNights', 'maxNightsBreached', 'maxNightsRules',
    'mergedNightly', 'minNightsBreached', 'minNightsRules', 'nightlyBreakdown', 'nights', 'requiredMaxNights',
    'requiredMinNights', 'totalPrice',
  ],
  apply(ctx) {
    const { endDate, lockedNightlyBreakdown, rules, startDate } = ctx;

    const calculatedBase = calculateBaseStayPrice(rules, startDate, endDate);
    const {
      nights,
      nightlyBreakdown: freshNightlyBreakdown,
      requiredMinNights,
      minNightsRules,
      minNightsBreached,
      requiredMaxNights,
      maxNightsRules,
      maxNightsBreached,
      unpricedNights: freshUnpricedNights,
    } = calculatedBase;
    if (nights <= 0) {
      // The finished quote of a stay with no night is COMPOSE's (`haltedQuote`): the run stops here.
      return { ...ctx, halt: true };
    }

    const mergedNightly = mergeNightlyBreakdownWithLocked(lockedNightlyBreakdown, freshNightlyBreakdown);
    const nightlyBreakdown = mergedNightly.nightlyBreakdown;
    const baseAccommodationPrice = mergedNightly.totalPrice;

    const totalPrice = roundMoney(baseAccommodationPrice);

    // specs/tariff-recipes/spec.md §3.4 rules 21-23 — changeover-day check, exposed beside the
    // min-nights fields and enforced by the controller with the same force-override pattern.
    const changeover = checkChangeover(rules, startDate, endDate);

    return {
      ...ctx,
      baseAccommodationPrice, changeover, freshUnpricedNights, maxNightsBreached, maxNightsRules,
      mergedNightly, minNightsBreached, minNightsRules, nightlyBreakdown, nights, requiredMaxNights,
      requiredMinNights, totalPrice,
    };
  },
};

module.exports = step;
