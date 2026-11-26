/**
 * The use cases built from the steps (specs/pricing/pricing-components.md §3 rule 52).
 *
 * `stayQuote` (fiche, devis, intakes): loadStay → clock → nights → extraGuests → discountLevers → extras → midStay →
 * platformGross → touristTax → platformPrice → discounts → vat → totals → inComplement → schedule → platformPayment →
 * settlement → netTotals. The order follows the engine's own dependencies: the tourist tax needs the platform pin and
 * the pre-arrival extras, the platform price needs the reversed tax, the platform payment follows the schedule
 * (rule 70). `staySale` (rules 8, 9, PR C): `stayQuote` with `storedNights`, `storedExtraGuests` and `storedTouristTax` in place of
 * `nights`, `extraGuests` and `touristTax` — a sale on a stay (the fiche's « Ajouter un produit », the SAS's sold options, the guest-app
 * shop, an offer, a removal, a line discount, all through `extraSale`) prices the nights, the extra guests and the tax as stored and
 * judges no minimum, maximum or changeover. Its runs take `storedSaleFigures` (the stay's stored records) beside `input`. `ficheSale`, `sasSale` and `shopSale` (rule 54) are that one use case
 * under the name of the seller that runs it (`salePipelineOf(source)`). `externalSale` (rule 53, PR C): loadCatalogue → externalExtras →
 * externalVat → externalTotals → externalPayment, the sale of an article with no stay (the « Vente hors séjour » counter, the outside visit). The
 * line discounts of rule 39 are not a step of it: « Offrir » is the one gesture (rule 14).
 */
const { buildPipeline } = require('./pipeline');
const loadStay = require('./steps/loadStay');
const clock = require('./steps/clock');
const nights = require('./steps/nights');
const storedNights = require('./steps/storedNights');
const storedExtraGuests = require('./steps/storedExtraGuests');
const storedTouristTax = require('./steps/storedTouristTax');
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
const externalCatalogue = require('./steps/externalCatalogue');
const externalExtras = require('./steps/externalExtras');
const externalVat = require('./steps/externalVat');
const externalTotals = require('./steps/externalTotals');
const externalPayment = require('./steps/externalPayment');

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
 *     discountFixedAmount, lineFacts, refundedNoteCredit, refundedStayCredit,
 *     complementClaims, refundedComplementCredit, complementCreditPhantom
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
 *     installmentPlan, installmentRest, isTouristTaxForcedToComplement, midStayLinesWithExcess, midStayRemainingDue,
 *     midStaySettledAll, noteCreditCuts, overCollectedTtc, planScheduled, platformIsNonDirect, preArrivalAmount, rawComplement,
 *     resolvedBalanceAmount, resolvedComplementAmount, resolvedDepositAmount, taxInComplement
 * platformPayment: acompteCommissionAmount, platformCommissionAmount, platformNetReceivedAmount,
 *     totalPlatformCommission
 * settlement: complementDetailLines, complementSplit
 * netTotals: resolvedArrivalReduction, resolvedArrivalTip, resolvedRefundsTotal, sejourNetTotal
 * halt (reserved): a finished result a step may return to stop the run (nights: a stay with no night).
 */

/**
 * @typedef {object} ExternalSaleContext
 * The context of `externalSale` (rule 53); `input` is `{ requests, fulfilments, stored, allocations, families, settings, vatRegime }`.
 * loadCatalogue: requests, fulfilments, stored, allocations, families, settings, vatRegime
 * externalExtras: quoted, refusals
 * externalVat: familyVat, vatRefusals
 * externalTotals: lines, totalCents, vatByRate
 * externalPayment: settlement
 */

const STAY_STEPS = [loadStay, clock, nights, extraGuests, discountLevers, extras, midStay, platformGross, touristTax, platformPrice, discounts, vat, totals, inComplement, schedule, platformPayment, settlement, netTotals];
const STEPS_BY_ID = Object.fromEntries(STAY_STEPS.map((step) => [step.id, step]));
const stayQuote = buildPipeline(STAY_STEPS, { initial: ['input'] });

// Rules 8, 9 — the sale on a stored stay: the same steps, the nights, the extra guests and the tax read as stored (never NIGHTS'
// tariff nor its judgments, never the extra-guest or tax settings).
const AS_STORED = { nights: storedNights, extraGuests: storedExtraGuests, touristTax: storedTouristTax };
const SALE_STEPS = stayQuote.steps.map((id) => AS_STORED[id] || STEPS_BY_ID[id]);
const SALE_INITIAL = ['input', 'storedSaleFigures'];
const staySale = buildPipeline(SALE_STEPS, { initial: SALE_INITIAL });

// Rule 54 — a pipeline per caller, chosen by the caller: the fiche's « Ajouter un produit » and its line gestures (`ficheSale`), the SAS's sales
// (`sasSale`), the guest app's shop (`shopSale`). The three are the `staySale` steps (one sale on a stored stay, whoever sells); their names
// let a seller say which use case it runs, never assemble one.
const ficheSale = buildPipeline(SALE_STEPS, { initial: SALE_INITIAL });
const sasSale = buildPipeline(SALE_STEPS, { initial: SALE_INITIAL });
const shopSale = buildPipeline(SALE_STEPS, { initial: SALE_INITIAL });
const SALE_PIPELINES = Object.freeze({ fiche: ficheSale, sas: sasSale, shop: shopSale });

// The sale pipeline of a seller (`extraSale`'s source: `fiche`, `sas`, `shop`); null for any other name.
function salePipelineOf(source) {
  return Object.hasOwn(SALE_PIPELINES, source) ? SALE_PIPELINES[source] : null;
}

// The tourist-tax slice of `stayQuote` (rule 3): the steps TOURIST TAX needs, stopping where it has provided. The report of the
// tax a platform remits itself reads its figures here instead of replaying the whole quote.
const touristTaxFigure = buildPipeline(
  [loadStay, clock, nights, extraGuests, discountLevers, extras, midStay, platformGross, touristTax],
  { initial: ['input'] },
);

// The sale of an article to a customer with no stay (rule 53): the same families, the external VAT, SETTLEMENT's remaining amount.
const externalSale = buildPipeline(
  [externalCatalogue, externalExtras, externalVat, externalTotals, externalPayment],
  { initial: ['input'] },
);

module.exports = {
  stayQuote, staySale, ficheSale, sasSale, shopSale, salePipelineOf, touristTaxFigure, externalSale,
};
