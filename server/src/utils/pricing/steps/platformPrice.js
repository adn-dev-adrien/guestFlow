/**
 * STEP platformPrice — PLATFORM PRICE (specs/pricing-components.md §3 rule 52).
 *
 * Back-solves the accommodation from the platform brut and picks the accommodation actually charged.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { resolvePlatformPrice } = require('../platformPrice');
const { allocateDiscount } = require('../discounts');

const step = {
  id: 'platformPrice',
  requires: [
    'accommodationBaseTotal', 'customFinalPrice', 'extraGuestInBrutSurcharge', 'nightsFixedAmount', 'normalizedDiscountPercent',
    'platformGrossPin', 'preArrivalOptionsResources', 'touristTaxGap', 'accommodationDiscountShareCents',
  ],
  provides: ['accommodationAdjustedPrice', 'pinnedAccommodation'],
  apply(ctx) {
    const {
      accommodationBaseTotal, customFinalPrice, extraGuestInBrutSurcharge, nightsFixedAmount, normalizedDiscountPercent,
      platformGrossPin, preArrivalOptionsResources, touristTaxGap, accommodationDiscountShareCents,
    } = ctx;

    // specs/platform-host-statement-and-commission-vat.md rules 1, 3, 7 — the brut is the host amount of the statement:
    // the rent is what remains of it once the platform-billed extras and the extra-guest surcharge are out, plus the
    // tourist-tax gap of a reversed tax. Nothing else is subtracted.
    const { accommodation: pinnedAccommodation } = resolvePlatformPrice({
      gross: platformGrossPin,
      extraGuestsInBrut: extraGuestInBrutSurcharge,
      platformLines: preArrivalOptionsResources,
      taxGap: touristTaxGap,
    });
    const accommodationAdjustedPrice = roundMoney(
      pinnedAccommodation != null
        ? pinnedAccommodation
        : allocateDiscount({
          discount: { percent: normalizedDiscountPercent, amount: nightsFixedAmount, customPrice: customFinalPrice, target: 'nights' },
          accommodation: accommodationBaseTotal,
        }).accommodation - accommodationDiscountShareCents / 100
    );

    return { ...ctx, accommodationAdjustedPrice, pinnedAccommodation };
  },
};

module.exports = step;
