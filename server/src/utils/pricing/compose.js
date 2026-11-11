/**
 * COMPOSE — the `stayQuote` pipeline plus `shape()` to the quote the callers read (specs/pricing-components.md §3 rule 4).
 *
 * Contract: `compose(input)` takes the engine input as the loader completed it (`models/pricingInputModel.js`), runs
 * `stayQuote` and shapes the resulting context into the 132-key quote `calculateReservationQuote` has always returned —
 * or returns the finished result a step halted with (a stay with no night). `shape(ctx)` names keys: every figure is a
 * step's (rule 51). What it still derives itself is presentation of those figures, moved verbatim from the engine: the
 * rounded accommodation, the in-brut guest count, the original tourist tax, the tariff snapshot (`tariffSnapshot`: the extra
 * guest tiers and nights, the free units granted), the tax base of a platform pin and the headline / summary cascade.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('./money');
const { extraGuestNightSeason } = require('./extraGuests');
const { quoteHeadline, summaryCascade } = require('../quoteHeadline');
const { stayQuote } = require('./pipelines');

function shape(ctx) {
  const {
    accommodationAdjustedPrice, accommodationDeltaAmount, accommodationDeltaType, accommodationDiscountAmount,
    accommodationNetPrice, accommodationPreArrival, accommodationVatAmount, acompteCommissionAmount,
    autoComplementAmount, autoDepositAmount, balanceDueDate, baseAccommodationAdjustedPrice,
    baseAccommodationPrice, cancellationInsuranceBase, changeover, channel, complementCollectedExcess,
    complementDetailLines, complementSplit, consumedMap, depositDueDate, discountAmount,
    endOfStayComplementAutoTotal, endOfStayComplementTotal, engineFinalPrice, extraGuestCalc,
    extraGuestComplementCount, extraGuestComplementOriginal, extraGuestComplementSurcharge, extraGuestCount,
    extraGuestInBrutSurcharge, extraGuestPriceUnit, extraGuestSurcharge, extraGuestSurchargeOriginal,
    extraGuestUnitPrice, finalOptionLines, finalPrice, forcedItemsTotal, freezeTouristTax, freshUnpricedNights,
    frozenTouristTaxAt, grantedFreeUnitsFor, includedGuests, isExtraGuestSurchargeOffered,
    isTouristTaxCollectedOnArrival, isTouristTaxForcedToComplement, isTouristTaxOfferedByPlatform,
    isTouristTaxRemittedByOwnerFlag, lockedTariff, maxNightsBreached, maxNightsRules, mergedNightly,
    midStayLinesWithExcess, midStayRemainingDue, midStaySettledAll, midStayTotal, minNightsBreached,
    minNightsRules, nightlyBreakdown, nights, normalizedDiscountPercent, optionsNetPrice, optionsTotal,
    optionsVatAmount, overCollectedTtc, persons, platformCommissionAmount, platformGrossPin,
    platformIsNonDirect, platformNetReceivedAmount, platformPaidAdults, platformTakesDeposit, preArrivalAmount,
    priceOverridden, property, rawComplement, requiredMaxNights, requiredMinNights, resolvedArrivalReduction,
    resolvedArrivalTip, resolvedBalanceAmount, resolvedComplementAmount, resolvedDepositAmount,
    resolvedPlatformPaidGuests, resolvedPlatformPaidOccupants, resolvedRefundsTotal, resourceLines,
    resourcesNetPrice, resourcesTotal, resourcesVatAmount, rules, sejourNetTotal, soldGrantMap, subtotal,
    taxAccommodationPaid, taxBaseAccommodation, taxBaseBeforeDeduction, totalNetPrice, totalPlatformCommission,
    totalPrice, totalStayPrice, totalVatAmount, touristTaxAddedGuestsAdults, touristTaxAddedGuestsAmount,
    touristTaxBreakdown, touristTaxBrutInconsistent, touristTaxIncludedInRateDeduction,
    touristTaxReversedByPlatform, touristTaxTotal, vatPercentageAccommodation, vatPercentageOptions,
    vatPercentageResources, vatRegime, withheldTouristTaxEntered, withheldTouristTaxInBrut,
  } = ctx;

  const quote = {
    property,
    nights,
    nightlyBreakdown,
    requiredMinNights,
    minNightsRules,
    minNightsBreached,
    // specs/tariff-recipes/spec.md §3.4 rule 20bis — maximum stay, mirror of the minimum.
    requiredMaxNights,
    maxNightsRules,
    maxNightsBreached,
    // Rule 59 — named whether or not the night is locked: a stay saved on the default price keeps it
    // in its lock, and the fiche must keep saying that no season covers it.
    unpricedNights: freshUnpricedNights,
    changeoverBreached: changeover.breached,
    changeoverArrivalBreached: changeover.arrivalBreached,
    changeoverDepartureBreached: changeover.departureBreached,
    requiredArrivalWeekday: changeover.requiredArrivalWeekday,
    requiredDepartureWeekday: changeover.requiredDepartureWeekday,
    requiredArrivalDayLabel: changeover.requiredArrivalDayLabel,
    requiredDepartureDayLabel: changeover.requiredDepartureDayLabel,
    persons,
    totalPrice: roundMoney(totalPrice),
    baseAccommodationPrice: roundMoney(baseAccommodationPrice),
    includedGuests,
    extraGuestUnitPrice,
    // specs/tariff-recipes/spec.md §3.6 — the unit + Σ of per-night ratios (e.g. 2,4 for a 3-night
    // stay at 1 + 0,7 + 0,7) so the client renders « 27 €/nuit × 2 pers. × 3 nuits » without math.
    extraGuestPriceUnit,
    extraGuestNightlyRatioTotal: extraGuestCalc.ratioTotal,
    // Tiered supplement: the phrased rule, so the summary shows « 15,00 € la 1ʳᵉ nuit, puis 8,00
    // €/nuit » instead of a single unit price that no night actually costs. `netPrice` (the channel
    // net pivot stored beside each band) is STRIPPED: margin targets stay server-side and never
    // reach a fiche or a public quote payload.
    extraGuestTiers: extraGuestCalc.tiers
      ? extraGuestCalc.tiers.map((t) => ({ fromNight: t.fromNight, price: t.price }))
      : null,
    extraGuestTiersLabel: extraGuestCalc.label || null,
    extraGuestCount,
    extraGuestSurchargeOffered: isExtraGuestSurchargeOffered,
    extraGuestSurchargeOriginal,
    extraGuestSurcharge,
    extraGuestInBrutCount: extraGuestCount - extraGuestComplementCount,
    extraGuestInBrutSurcharge,
    extraGuestComplementCount,
    extraGuestComplementOriginal,
    extraGuestComplementSurcharge,
    platformPaidGuests: resolvedPlatformPaidGuests,
    optionsTotal,
    resourcesTotal,
    subtotal,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalPrice,
    engineFinalPrice,
    priceOverridden,
    depositAmount: resolvedDepositAmount,
    // specs/reservation-payment-ledger.md rule 16 — the percentage acompte, so the ledger can say
    // « Montant fixé · calcul auto X » under a frozen one without computing it.
    autoDepositAmount,
    balanceAmount: resolvedBalanceAmount,
    complementAmount: resolvedComplementAmount,
    overCollectedTtc,
    complementCollectedExcessTtc: complementCollectedExcess,
    // What the complement carries on its own (forced lines + tax + the gap), whatever was collected or adjusted.
    complementRoutedAmount: rawComplement,
    // specs/adjustable-complement-amounts.md §3.6 — what the engine produces on its own, so the fiche
    // can print « Calcul auto (X €) » under the adjustment field and ventilate the adjusted amount
    // over the postes the auto complement is actually made of.
    complementAmountAuto: autoComplementAmount,
    complementDetailLines,
    endOfStayComplementAutoTotal,
    depositDueDate,
    balanceDueDate,
    baseAccommodationAdjustedPrice,
    ...touristTaxBreakdown,
    touristTaxOriginalTotal: Number(touristTaxBreakdown.touristTaxTotal || 0),
    touristTaxTotal,
    // specs/tariff-recipes/spec.md §3.2 rule 12bis — the tariff context this quote was built with,
    // ready to be stored on the reservation so a later edit replays it instead of today's recipe.
    tariffSnapshot: {
      includedGuests,
      extraGuestPrice: extraGuestUnitPrice,
      extraGuestPriceUnit,
      // `[]` = sold without tiers, an explicit answer; `null` only survives in snapshots written
      // before the 2026-10-27 spec review, and replays as « no tiers » too (rule 12ter backfill).
      // A replay stores the table it replayed, verbatim (rule 67): the engine priced with it, and a
      // legacy `null` is how the operator still finds the stays sold before the fix.
      extraGuestTiers: lockedTariff
        ? (lockedTariff.extraGuestTiers ?? null)
        : (extraGuestCalc.tiers || []),
      // Rule 58 — the season each night was sold under, for the per-night supplement.
      extraGuestNights: extraGuestPriceUnit === 'per_night'
        ? Object.fromEntries(nightlyBreakdown.map((night) => {
          const date = String(night.date);
          const sold = lockedTariff?.extraGuestNights && mergedNightly.lockedDates.has(date)
            ? lockedTariff.extraGuestNights[date]
            : null;
          if (sold) return [date, sold];
          const live = extraGuestNightSeason(rules, date, extraGuestUnitPrice);
          return [date, { base: live.nightlyBase, unit: live.seasonUnit }];
        }))
        : null,
      // Rule 66 — consumed by the lines this quote stores (the add-back of the next save)…
      freeUnitsByOption: Object.fromEntries(
        finalOptionLines
          .filter((line) => line && Number(line.freeUnits || 0) > 0)
          .map((line) => [String(line.optionId), Number(line.freeUnits)]),
      ),
      // …and granted: every grant the stay ever had, kept when its line goes, plus the lines it holds.
      grantedFreeUnitsByOption: {
        ...(soldGrantMap || (lockedTariff ? consumedMap : {})),
        ...Object.fromEntries(
          finalOptionLines
            .filter((line) => line && line.optionId != null)
            .map((line) => [String(line.optionId), grantedFreeUnitsFor(line.optionId)]),
        ),
      },
    },
    // specs/tourist-tax-included-services-deduction.md §4.3 — the accommodation the tax is computed
    // on, plus the two halves it comes from, so the summary can render « Base : X − Y de prestations
    // comprises » without subtracting them back (wrong whenever the base was floored at 0).
    touristTaxBaseAccommodation: taxBaseAccommodation,
    // On a pinned brut the base starts from what the guest paid (the brut less the extras and the
    // supplement it carries), not from the tariff: the caption must name the figure actually used
    // (tourist-tax-included-services-deduction.md rule 17, spec review 2026-10-27).
    touristTaxBaseBeforeDeduction: platformGrossPin != null
      ? roundMoney(Math.max(0, taxAccommodationPaid - extraGuestInBrutSurcharge))
      : taxBaseBeforeDeduction,
    touristTaxIncludedInRateDeduction,
    // specs/tourist-tax-matches-the-office-calculation.md — the accommodation the guest paid before
    // the two deductions (rules 2-3), whether the fiche is frozen (rule 12), and the inconsistent-brut
    // flag (rule 16). The fiche and the declaration render them; neither recomputes anything.
    touristTaxAccommodationPaid: taxAccommodationPaid,
    touristTaxFrozen: Boolean(freezeTouristTax),
    touristTaxFrozenAt: freezeTouristTax ? (frozenTouristTaxAt || null) : null,
    touristTaxBrutInconsistent,
    touristTaxOfferedByPlatform: isTouristTaxOfferedByPlatform,
    touristTaxRemittedByOwner: isTouristTaxRemittedByOwnerFlag,
    touristTaxCollectedOnArrival: isTouristTaxCollectedOnArrival,
    // Case 1: the platform collects the tax from the guest then reverses it to us at settlement → it's
    // charged in the BALANCE (not offered, not collected at arrival) and WE declare/remit it. Drives
    // the dedicated PricingSummary caption.
    touristTaxReversedByPlatform,
    touristTaxInComplement: isTouristTaxForcedToComplement,
    // specs/platform-added-guests-tourist-tax.md §4.3.
    touristTaxAddedGuestsAmount,
    touristTaxAddedGuestsAdults,
    platformPaidAdults: platformGrossPin != null && platformPaidAdults != null ? Number(platformPaidAdults) : null,
    platformPaidOccupants: platformGrossPin != null && platformPaidAdults != null ? resolvedPlatformPaidOccupants : null,
    forcedItemsTotal,
    // specs/mid-stay-extras-to-end-of-stay-complement.md — what was sold during the stay: the total
    // the engine carved out of the other buckets, and the ready-to-store end-of-stay detail lines.
    midStayExtrasTotal: midStayTotal,
    midStayExtrasLines: midStayLinesWithExcess,
    // specs/mid-stay-notes.md — already collected through a note vs still due at check-out.
    midStaySettledTotal: midStaySettledAll,
    midStayRemainingTotal: midStayRemainingDue,
    endOfStayComplementTotal,
    // specs/reservation-refunds.md — surfaced so the fiche can show the « Remboursements » line.
    refundsTotal: resolvedRefundsTotal,
    // Echoed so the summary can print its own row for each, like « Remboursements » above.
    arrivalPaymentReduction: resolvedArrivalReduction,
    arrivalPaymentTip: resolvedArrivalTip,
    complementSplit,
    preArrivalAmount,
    // specs/tourist-tax-on-solde.md — accommodation-only pre-arrival (no tax); the contribs capture uses
    // it so the acompte's tourist-tax contribution is 0 (the whole tax is credited on the solde entry).
    accommodationPreArrival,
    // Assiette of a `percent_of_stay` option (specs/cancellation-insurance.md §3.1 rule 3). Returned
    // so the public quote can price the insurance PREVIEW with the same helper as the billed line.
    cancellationInsuranceBase,
    totalStayPrice,
    // specs/fiche-total-sejour-net-of-commission.md — the « total du séjour » shown on the fiche
    // (and, later, in the finance displays) = net perçu + compléments. Net of the platform commission.
    sejourNetTotal,
    // specs/platform-commission-line.md — operator-entered platform commission + the resulting net
    // for the « total séjour − commission = net perçu » summary block. Commission 0 (direct / none) →
    // platformNetReceivedAmount null, the summary shows the single « Total du séjour TTC » line.
    platformCommissionAmount,
    // specs/platform-per-echeance-commission.md — the acompte commission + the total (acompte + solde).
    acompteCommissionAmount,
    totalPlatformCommission,
    platformNetReceivedAmount,
    // specs/platform-deposit-toggle.md — echo whether THIS platform takes an acompte, so the fiche
    // shows the acompte block (vs the « pas d'acompte » message) for a platform reservation.
    platformTakesDeposit: platformIsNonDirect && Boolean(platformTakesDeposit),
    // specs/plugins-phase-p-productisation.md rule 45 — whether this stay is a platform SALE (a channel
    // counted as direct is not), so the fiche never decides it from the platform's name.
    platformSale: channel.platformSale,
    // specs/platform-payment-entry.md — echo the brut (pins finalPrice) so the client repopulates the field.
    platformGrossAmount: platformGrossPin,
    // specs/platform-tourist-tax-out-of-the-commission.md rule 9 — the amount actually withheld, or
    // null when the box is empty / the mode isn't « collecte ET reverse ». Distinct from
    // `touristTaxOriginalTotal`, which stays the engine's OWN estimate: the fiche displays the
    // withheld one and falls back to the estimate, « Reprendre le calcul » offers the estimate.
    platformTouristTaxWithheld: withheldTouristTaxEntered ? withheldTouristTaxInBrut : null,
    defaultCheckIn: property.defaultCheckIn || '15:00',
    defaultCheckOut: property.defaultCheckOut || '10:00',
    optionLines: finalOptionLines,
    resourceLines,
    // VAT breakdown (all prices are TTC)
    vatPercentageAccommodation,
    vatPercentageOptions,
    vatPercentageResources,
    vatRegime,
    accommodationAdjustedPrice,
    accommodationDiscountAmount,
    accommodationDeltaAmount,
    accommodationDeltaType,
    accommodationNetPrice,
    accommodationVatAmount,
    optionsNetPrice,
    optionsVatAmount,
    resourcesNetPrice,
    resourcesVatAmount,
    totalNetPrice,
    totalVatAmount,
  };
  // specs/ui-review-2026-10-19-operations.md rule 10 — the figure the fiche's total bar leads with.
  quote.headline = quoteHeadline(quote, { isPlatform: channel.platformSale });
  quote.summaryCascade = summaryCascade(quote);
  return quote;
}

function compose(input) {
  const ctx = stayQuote({ input });
  if (ctx.halt) return ctx.halt;
  return shape(ctx);
}

module.exports = { compose, shape };
