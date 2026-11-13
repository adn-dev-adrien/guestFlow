/**
 * STEP discountLevers — DISCOUNTS (specs/pricing-components.md §3 rule 52).
 *
 * Normalises the price levers (discount percent, manual price) and the accommodation base a `percent_of_stay`
 * option is priced on.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { allocateDiscount, normalizeDiscountPercent, normalizeCustomPrice } = require('../discounts');

const step = {
  id: 'discountLevers',
  requires: ['customPrice', 'discountPercent', 'extraGuestSurcharge', 'totalPrice'],
  provides: ['cancellationInsuranceBase', 'customFinalPrice', 'normalizedDiscountPercent'],
  apply(ctx) {
    const { customPrice, discountPercent, extraGuestSurcharge, totalPrice } = ctx;

    // Price levers, normalised HERE rather than beside the totals below: a `percent_of_stay` option
    // (specs/cancellation-insurance.md §3.1) is priced inside the option loop and needs them.
    const normalizedDiscountPercent = normalizeDiscountPercent(discountPercent);
    const customFinalPrice = normalizeCustomPrice(customPrice);
    // Assiette of a `percent_of_stay` option (rule 3): the ACCOMMODATION actually charged — the
    // nights after a discount or a manual override, plus the extra-guest surcharge (a supplement on
    // the nights, not an option). Options, resources, taxe de séjour and caution are excluded.
    //
    // Deliberately computed BEFORE the platform back-solve below (`platformGrossAmount` pins the
    // accommodation FROM the extras): reading the pinned accommodation here would be circular —
    // the option would depend on a total that depends on the option.
    const cancellationInsuranceBase = roundMoney(
      (Number.isFinite(customFinalPrice)
        ? customFinalPrice
        : allocateDiscount({ discount: { percent: normalizedDiscountPercent, target: 'nights' }, accommodation: totalPrice }).accommodation)
      + extraGuestSurcharge,
    );

    return { ...ctx, cancellationInsuranceBase, customFinalPrice, normalizedDiscountPercent };
  },
};

module.exports = step;
