/**
 * STEP extraGuests — EXTRA GUESTS (specs/pricing-components.md §3 rule 52).
 *
 * The supplement of the guests above what the rate includes, split between the platform's brut and the arrival
 * complement.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { isBrutPinned } = require('../../platformPaidGuests');
const { computeExtraGuestSurcharge, splitExtraGuestCount } = require('../extraGuests');

const step = {
  id: 'extraGuests',
  requires: [
    'extraGuestSurchargeOffered', 'isDirectBooking', 'lockedTariff', 'mergedNightly', 'nightlyBreakdown',
    'persons', 'platform', 'platformGrossAmountInput', 'platformPaidGuests', 'property', 'rules',
  ],
  provides: [
    'extraGuestCalc', 'extraGuestComplementCount', 'extraGuestComplementOriginal', 'extraGuestComplementSurcharge',
    'extraGuestCount', 'extraGuestInBrutSurcharge', 'extraGuestPriceUnit', 'extraGuestSurcharge',
    'extraGuestSurchargeOriginal', 'extraGuestUnitPrice', 'includedGuests', 'isExtraGuestSurchargeOffered',
    'resolvedPlatformPaidGuests',
  ],
  apply(ctx) {
    const {
      extraGuestSurchargeOffered, isDirectBooking, lockedTariff, mergedNightly, nightlyBreakdown,
      persons, platform, platformGrossAmountInput, platformPaidGuests, property, rules,
    } = ctx;

    // specs/tariff-recipes/spec.md §3.2 rule 12bis — a reservation is priced by the tariff in force
    // WHEN IT WAS SOLD. Nights and option lines were already frozen (per date, per line); the
    // property-level tariff was not, so editing an old reservation silently re-priced its supplement
    // with today's recipe. `lockedTariff` is that missing half, captured at creation and replayed on
    // every later save. Absent (reservations created before the column, and every fresh quote) → the
    // live property, which is the correct source for a reservation being sold now.
    const includedGuests = lockedTariff?.includedGuests != null
      ? Math.max(0, Number(lockedTariff.includedGuests))
      : Math.max(0, Number(property.basePriceIncludedGuests || 0));
    const extraGuestUnitPrice = lockedTariff?.extraGuestPrice != null
      ? Math.max(0, Number(lockedTariff.extraGuestPrice))
      : Math.max(0, Number(property.extraGuestPrice || 0));
    const extraGuestPriceUnit = (lockedTariff?.extraGuestPriceUnit ?? property.extraGuestPriceUnit) === 'per_night'
      ? 'per_night' : 'per_stay';
    const isExtraGuestSurchargeOffered = Boolean(extraGuestSurchargeOffered);
    // specs/platform-extra-guest-complement.md — a non-direct reservation counts no supplement until its
    // brut is entered (rule 1); once it is, the guests above what the platform billed are collected on
    // arrival (rules 7-10) and only they can be offered (rule 13).
    const hasBrutPin = isBrutPinned(platform, platformGrossAmountInput);
    const extraGuestCount = (!isDirectBooking && !hasBrutPin) ? 0 : Math.max(0, persons - includedGuests);
    const resolvedPlatformPaidGuests = hasBrutPin && platformPaidGuests != null && Number.isFinite(Number(platformPaidGuests))
      ? Math.max(0, Number(platformPaidGuests))
      : null;
    const extraGuestSplit = splitExtraGuestCount({ persons, includedGuests, paidGuests: resolvedPlatformPaidGuests });
    const surchargeFor = (count) => computeExtraGuestSurcharge({
      unit: extraGuestPriceUnit,
      extraGuestCount: count,
      propertyUnitPrice: extraGuestUnitPrice,
      nightlyBreakdown,
      rules,
      // `undefined` = no snapshot → read the live season. An EMPTY array = sold without tiers, which
      // is an answer, not an absence: confusing the two let the new recipe back in through the
      // fallback (a test caught exactly that).
      lockedTiers: lockedTariff ? (lockedTariff.extraGuestTiers ?? []) : undefined,
      lockedNights: lockedTariff?.extraGuestNights || null,
      lockedDates: mergedNightly.lockedDates,
    });
    const extraGuestCalc = surchargeFor(extraGuestCount);
    const extraGuestSurchargeOriginal = extraGuestCalc.total;
    const extraGuestComplementCount = hasBrutPin ? extraGuestSplit.complementGuests : 0;
    const extraGuestInBrutSurcharge = extraGuestComplementCount > 0
      ? surchargeFor(extraGuestCount - extraGuestComplementCount).total
      : extraGuestSurchargeOriginal;
    const extraGuestComplementOriginal = roundMoney(extraGuestSurchargeOriginal - extraGuestInBrutSurcharge);
    const extraGuestComplementSurcharge = isExtraGuestSurchargeOffered ? 0 : extraGuestComplementOriginal;
    // On a pinned brut the in-brut part was paid on the platform: « Offrir » never reaches it.
    const extraGuestSurcharge = hasBrutPin
      ? roundMoney(extraGuestInBrutSurcharge + extraGuestComplementSurcharge)
      : (isExtraGuestSurchargeOffered ? 0 : extraGuestSurchargeOriginal);

    return {
      ...ctx,
      extraGuestCalc, extraGuestComplementCount, extraGuestComplementOriginal,
      extraGuestComplementSurcharge, extraGuestCount, extraGuestInBrutSurcharge, extraGuestPriceUnit,
      extraGuestSurcharge, extraGuestSurchargeOriginal, extraGuestUnitPrice, includedGuests,
      isExtraGuestSurchargeOffered, resolvedPlatformPaidGuests,
    };
  },
};

module.exports = step;
