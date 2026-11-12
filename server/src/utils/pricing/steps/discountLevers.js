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
  requires: ['customPrice', 'discountPercent', 'discountTarget', 'extraGuestSurcharge', 'totalPrice'],
  provides: ['cancellationInsuranceBase', 'customFinalPrice', 'normalizedDiscountPercent', 'typedDiscountPercent'],
  apply(ctx) {
    const { customPrice, discountPercent, discountTarget, extraGuestSurcharge, totalPrice } = ctx;

    // Price levers, normalised HERE rather than beside the totals below: a `percent_of_stay` option
    // (specs/cancellation-insurance.md §3.1) is priced inside the option loop and needs them.
    // Rule 16: the percent of a stay discount aimed at the extras (or at everything) is shared out by `extras` over the lines and
    // the accommodation (rule 40); the nights' own formula then sees none, so nothing is discounted twice.
    const typedDiscountPercent = normalizeDiscountPercent(discountPercent);
    const normalizedDiscountPercent = discountTarget === 'nights' ? typedDiscountPercent : 0;
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

    return { ...ctx, cancellationInsuranceBase, customFinalPrice, normalizedDiscountPercent, typedDiscountPercent };
  },
};

module.exports = step;
