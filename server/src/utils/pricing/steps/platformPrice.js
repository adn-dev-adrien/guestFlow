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
    'platformGrossPin', 'preArrivalOptionsResources', 'reversedTouristTaxInBrut', 'withheldTouristTaxInBrut',
    'accommodationDiscountShareCents',
  ],
  provides: ['accommodationAdjustedPrice', 'pinnedAccommodation'],
  apply(ctx) {
    const {
      accommodationBaseTotal, customFinalPrice, extraGuestInBrutSurcharge, nightsFixedAmount, normalizedDiscountPercent,
      platformGrossPin, preArrivalOptionsResources, reversedTouristTaxInBrut, withheldTouristTaxInBrut,
      accommodationDiscountShareCents,
    } = ctx;

    // « Offered » case (platform collects the tax AND remits it to the commune itself): what the brut
    // contains is now the operator's call, stated in euros (specs/platform-tourist-tax-out-of-the-
    // commission.md rules 3 and 6). `withheldTouristTaxInBrut` empty → the brut is the stay total the
    // platform BILLS US, tax excluded, and nothing is subtracted — the reading of
    // platform-brut-excludes-offered-tourist-tax.md, byte-identical. Non-empty → the brut is the
    // guest-paid total and the stated tax comes back out of it, so the revenue and the VAT base are the
    // stay alone. Never our own estimate: that is what made the earlier deduction unreconcilable.
    const { accommodation: pinnedAccommodation } = resolvePlatformPrice({
      gross: platformGrossPin,
      extraGuestsInBrut: extraGuestInBrutSurcharge,
      platformLines: preArrivalOptionsResources,
      withheldTax: [reversedTouristTaxInBrut, withheldTouristTaxInBrut],
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
