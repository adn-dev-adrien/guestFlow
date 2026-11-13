/**
 * STEP discounts — DISCOUNTS (specs/pricing-components.md §3 rule 52).
 *
 * The accommodation discount, delta and override figures and the engine price without any manual lever.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney, sumMoney } = require('../money');
const { allocateDiscount } = require('../discounts');

const step = {
  id: 'discounts',
  requires: [
    'accommodationAdjustedPrice', 'accommodationBaseTotal', 'baseAccommodationPrice', 'customFinalPrice',
    'extraGuestSurcharge', 'normalizedDiscountPercent', 'optionsTotal', 'pinnedAccommodation', 'resourcesTotal',
  ],
  provides: [
    'accommodationDeltaAmount', 'accommodationDeltaType', 'accommodationDiscountAmount',
    'baseAccommodationAdjustedPrice', 'engineFinalPrice', 'priceOverridden',
  ],
  apply(ctx) {
    const {
      accommodationAdjustedPrice, accommodationBaseTotal, baseAccommodationPrice, customFinalPrice,
      extraGuestSurcharge, normalizedDiscountPercent, optionsTotal, pinnedAccommodation, resourcesTotal,
    } = ctx;

    const accommodationDiscountAmount = roundMoney(Math.max(0, accommodationBaseTotal - accommodationAdjustedPrice));
    const accommodationDeltaAmount = roundMoney(Math.abs(accommodationBaseTotal - accommodationAdjustedPrice));
    const baseAccommodationAdjustedPrice = roundMoney(
      pinnedAccommodation != null
        ? pinnedAccommodation
        : allocateDiscount({
          discount: { percent: normalizedDiscountPercent, customPrice: customFinalPrice, target: 'nights' },
          accommodation: baseAccommodationPrice,
        }).accommodation
    );
    const accommodationDeltaType = accommodationAdjustedPrice < accommodationBaseTotal
      ? 'reduction'
      : accommodationAdjustedPrice > accommodationBaseTotal
        ? 'increase'
        : 'none';

    // Engine price = what the pricing engine computes ignoring any manual override, so the client can
    // show the engine value alongside an overridden price. `finalPrice` stays the effective amount.
    const priceOverridden = pinnedAccommodation != null || Number.isFinite(customFinalPrice);
    const engineAccommodationPrice = allocateDiscount({
      discount: { percent: normalizedDiscountPercent, target: 'nights' },
      accommodation: accommodationBaseTotal,
    }).accommodation;
    const engineFinalPrice = sumMoney([engineAccommodationPrice, extraGuestSurcharge, optionsTotal, resourcesTotal]);

    return {
      ...ctx,
      accommodationDeltaAmount, accommodationDeltaType, accommodationDiscountAmount,
      baseAccommodationAdjustedPrice, engineFinalPrice, priceOverridden,
    };
  },
};

module.exports = step;
