/**
 * The use cases built from the steps (specs/pricing-components.md §3 rule 52).
 *
 * `stayQuote` (fiche, devis, intakes): loadStay → clock → nights → extraGuests → discountLevers → extras → midStay →
 * platformGross → touristTax → platformPrice → discounts → vat → totals → inComplement → schedule → platformPayment →
 * settlement → netTotals. The order follows the engine's own dependencies: the tourist tax needs the platform pin and
 * the pre-arrival extras, the platform price needs the reversed tax, the platform payment follows the schedule
 * (rule 70). `ficheSale`, `sasSale`, `shopSale` and `externalSale` are not built in PR A.
 */
const { buildPipeline } = require('./pipeline');
const loadStay = require('./steps/loadStay');
const clock = require('./steps/clock');
const nights = require('./steps/nights');
const extraGuests = require('./steps/extraGuests');
const discountLevers = require('./steps/discountLevers');
const extras = require('./steps/extras');
const midStay = require('./steps/midStay');
const platformGross = require('./steps/platformGross');
const touristTax = require('./steps/touristTax');
const platformPrice = require('./steps/platformPrice');
const discounts = require('./steps/discounts');
const vat = require('./steps/vat');
const totals = require('./steps/totals');
const inComplement = require('./steps/inComplement');
const schedule = require('./steps/schedule');
const platformPayment = require('./steps/platformPayment');
const settlement = require('./steps/settlement');
const netTotals = require('./steps/netTotals');

/**
 * @typedef {object} QuoteContext
 * The flat context the `stayQuote` steps pass along: `input` is the engine input as the loader completed it, each step adds
 * the keys it provides (a key is provided once and never rewritten), listed here by step.
 * loadStay: property, vatRegime, vatRate, rules, optionsById, resourcesById, defaultOfferedOptionIds,
 *     settings, families, billableBabyBeds, paymentLedger, startDate, endDate, checkInTime, checkOutTime, adults,
 *     children, teens, babies, babyBeds, bookingId, discountPercent, customPrice, selectedOptions,
 *     customOptions, selectedResources, depositPaid, balancePaid, complementPaid, depositAmount, balanceAmount,
 *     complementAmount, offeredOptionIds, extraGuestSurchargeOffered, lockedOptionUnits, lockedResourceUnits,
 *     lockedNightlyBreakdown, lockedTariff, lockedOptionLines, lockedResourceLines, platform, depositDisabled,
 *     depositAmountOverride, complementAmountOverride, touristTaxInComplement, autoOptionsInComplement,
 *     freezeTouristTax, paidSoldeCaptured, frozenTouristTaxTotal, frozenTouristTaxRate, frozenTouristTaxBaseHt,
 *     frozenTouristTaxOccupants, frozenTouristTaxAt, platformCommissionAmountInput,
 *     acompteCommissionAmountInput, platformTakesDeposit, platformPayoutDueDays, platformGrossAmountInput,
 *     platformPaidAdults, platformPaidOccupants, storedTouristTaxAddedGuests,
 *     storedTouristTaxAddedGuestsAdults, platformPaidGuests, platformTouristTaxAmountInput,
 *     planningCardAsQuantity, endOfStaySasAmount, endOfStaySasAmountAuto, endOfStayComplementSettled,
 *     frozenMidStayLines, midStaySettledNotes, refundsTotal, platformPenaltyAmount, arrivalPaymentReduction,
 *     arrivalPaymentTip, complementDeferredToCheckout, complementCollected, quoteKind, validUntil,
 *     devisPromise, cancellationInsurancePriceOverride, channel, isDirectBooking, persons, discountTarget,
 *     discountFixedAmount, lineFacts
 * clock: clock
 * nights: baseAccommodationPrice, changeover, freshUnpricedNights, maxNightsBreached, maxNightsRules,
 *     mergedNightly, minNightsBreached, minNightsRules, nightlyBreakdown, nights, requiredMaxNights,
 *     requiredMinNights, totalPrice
 * extraGuests: extraGuestCalc, extraGuestComplementCount, extraGuestComplementOriginal,
 *     extraGuestComplementSurcharge, extraGuestCount, extraGuestInBrutSurcharge, extraGuestPriceUnit,
 *     extraGuestSurcharge, extraGuestSurchargeOriginal, extraGuestUnitPrice, includedGuests,
 *     isExtraGuestSurchargeOffered, resolvedPlatformPaidGuests
 * discountLevers: cancellationInsuranceBase, customFinalPrice, nightsFixedAmount, normalizedDiscountPercent, typedDiscountPercent
 * extras: accommodationDiscountShareCents, consumedMap, extrasDiscountCents, finalOptionLines, grantedFreeUnitsFor,
 *     optionsTotal, resourceLines, resourcesTotal, soldGrantMap
 * midStay: accommodationBaseTotal, midStayExtras, midStayForced, midStayRemainingTotal, midStaySettledTotal,
 *     midStayTotal, midStayUnforced, subtotal
 * platformGross: platformGrossPin, preArrivalOptionsResources
 * touristTax: isTouristTaxCollectedOnArrival, isTouristTaxOfferedByPlatform, isTouristTaxRemittedByOwnerFlag,
 *     resolvedPlatformPaidOccupants, reversedTouristTaxInBrut, taxAccommodationPaid, taxBaseAccommodation,
 *     taxBaseBeforeDeduction, touristTaxAddedGuestsAdults, touristTaxAddedGuestsAmount, touristTaxBreakdown,
 *     touristTaxBrutInconsistent, touristTaxIncludedInRateDeduction, touristTaxReversedByPlatform,
 *     touristTaxTotal, withheldTouristTaxEntered, withheldTouristTaxInBrut
 * platformPrice: accommodationAdjustedPrice, pinnedAccommodation
 * discounts: accommodationDeltaAmount, accommodationDeltaType, accommodationDiscountAmount,
 *     baseAccommodationAdjustedPrice, engineFinalPrice, priceOverridden
 * vat: accommodationNetPrice, accommodationVatAmount, familyVat, optionsNetPrice, optionsVatAmount,
 *     resourcesNetPrice, resourcesVatAmount, totalNetPrice, totalVatAmount, vatPercentageAccommodation,
 *     vatPercentageOptions, vatPercentageResources
 * totals: discountAmount, finalPrice, totalStayPrice
 * inComplement: complementForcedItemsTotal, forcedItemsTotal
 * schedule: accommodationPreArrival, autoComplementAmount, autoDepositAmount, balanceDueDate,
 *     complementCollectedExcess, depositDueDate, endOfStayComplementAutoTotal, endOfStayComplementTotal,
 *     installmentPlan, isTouristTaxForcedToComplement, midStayLinesWithExcess, midStayRemainingDue,
 *     midStaySettledAll, overCollectedTtc, planScheduled, platformIsNonDirect, preArrivalAmount, rawComplement,
 *     resolvedBalanceAmount, resolvedComplementAmount, resolvedDepositAmount, taxInComplement
 * platformPayment: acompteCommissionAmount, platformCommissionAmount, platformNetReceivedAmount,
 *     totalPlatformCommission
 * settlement: complementDetailLines, complementSplit
 * netTotals: resolvedArrivalReduction, resolvedArrivalTip, resolvedRefundsTotal, sejourNetTotal
 * halt (reserved): a finished result a step may return to stop the run (nights: a stay with no night).
 */

const stayQuote = buildPipeline(
  [loadStay, clock, nights, extraGuests, discountLevers, extras, midStay, platformGross, touristTax, platformPrice, discounts, vat, totals, inComplement, schedule, platformPayment, settlement, netTotals],
  { initial: ['input'] },
);

// The tourist-tax slice of `stayQuote` (rule 3): the steps TOURIST TAX needs, stopping where it has provided. The report of the
// tax a platform remits itself reads its figures here instead of replaying the whole quote.
const touristTaxFigure = buildPipeline(
  [loadStay, clock, nights, extraGuests, discountLevers, extras, midStay, platformGross, touristTax],
  { initial: ['input'] },
);

module.exports = { stayQuote, touristTaxFigure };
