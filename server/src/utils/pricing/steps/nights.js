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
  requires: ['endDate', 'lockedNightlyBreakdown', 'property', 'rules', 'startDate', 'vatRate', 'vatRegime'],
  provides: [
    'baseAccommodationPrice', 'changeover', 'freshUnpricedNights', 'maxNightsBreached', 'maxNightsRules',
    'mergedNightly', 'minNightsBreached', 'minNightsRules', 'nightlyBreakdown', 'nights', 'requiredMaxNights',
    'requiredMinNights', 'totalPrice',
  ],
  apply(ctx) {
    const { endDate, lockedNightlyBreakdown, property, rules, startDate, vatRate, vatRegime } = ctx;

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
      const halt = {
        property,
        nights: 0,
        nightlyBreakdown: [],
        requiredMinNights: 1,
        minNightsRules: [],
        minNightsBreached: false,
        requiredMaxNights: null,
        maxNightsRules: [],
        maxNightsBreached: false,
        unpricedNights: [],
        persons: 0,
        totalPrice: 0,
        optionsTotal: 0,
        resourcesTotal: 0,
        subtotal: 0,
        discountAmount: 0,
        finalPrice: 0,
        engineFinalPrice: 0,
        priceOverridden: false,
        depositAmount: 0,
        balanceAmount: 0,
        complementAmount: 0,
        complementAmountAuto: 0,
        depositDueDate: null,
        balanceDueDate: null,
        touristTaxRate: Number(property.touristTaxPerDayPerPerson || 0),
        touristTaxTotal: 0,
        totalStayPrice: 0,
        defaultCheckIn: property.defaultCheckIn || '15:00',
        defaultCheckOut: property.defaultCheckOut || '10:00',
        optionLines: [],
        resourceLines: [],
        vatPercentageAccommodation: vatRate,
        vatPercentageOptions: vatRate,
        vatPercentageResources: vatRate,
        vatRegime,
        accommodationNetPrice: 0,
        accommodationVatAmount: 0,
        optionsNetPrice: 0,
        optionsVatAmount: 0,
        resourcesNetPrice: 0,
        resourcesVatAmount: 0,
        totalNetPrice: 0,
        totalVatAmount: 0,
      };
      return { ...ctx, halt };
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
