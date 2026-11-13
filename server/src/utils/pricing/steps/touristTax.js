/**
 * STEP touristTax — TOURIST TAX (specs/pricing-components.md §3 rule 52).
 *
 * The tax base, the tax itself (frozen, reversed or offered by the platform), the added guests' tax and where
 * it is collected.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const {
  computeTouristTaxBreakdown, resolveAddedGuestsTouristTax, sumIncludedServicesDeduction, resolveTaxBase,
} = require('../touristTax');
const { allocateDiscount } = require('../discounts');
const articles = require('../articles');
const { getTypeMultiplier } = articles;

const step = {
  id: 'touristTax',
  requires: [
    'adults', 'baseAccommodationPrice', 'channel', 'children', 'complementPaid', 'customFinalPrice',
    'extraGuestInBrutSurcharge', 'finalOptionLines', 'freezeTouristTax', 'frozenTouristTaxBaseHt',
    'frozenTouristTaxOccupants', 'frozenTouristTaxRate', 'frozenTouristTaxTotal', 'includedGuests', 'nights',
    'normalizedDiscountPercent', 'persons', 'platform', 'platformGrossPin', 'platformPaidAdults',
    'platformPaidOccupants', 'platformTouristTaxAmountInput', 'preArrivalOptionsResources',
    'resolvedPlatformPaidGuests', 'settings', 'storedTouristTaxAddedGuests', 'storedTouristTaxAddedGuestsAdults',
    'teens', 'touristTaxInComplement', 'vatRate',
  ],
  provides: [
    'isTouristTaxCollectedOnArrival', 'isTouristTaxOfferedByPlatform', 'isTouristTaxRemittedByOwnerFlag',
    'resolvedPlatformPaidOccupants', 'reversedTouristTaxInBrut', 'taxAccommodationPaid', 'taxBaseAccommodation',
    'taxBaseBeforeDeduction', 'touristTaxAddedGuestsAdults', 'touristTaxAddedGuestsAmount', 'touristTaxBreakdown',
    'touristTaxBrutInconsistent', 'touristTaxIncludedInRateDeduction', 'touristTaxReversedByPlatform',
    'touristTaxTotal', 'withheldTouristTaxEntered', 'withheldTouristTaxInBrut',
  ],
  apply(ctx) {
    const {
      adults, baseAccommodationPrice, channel, children, complementPaid, customFinalPrice,
      extraGuestInBrutSurcharge, finalOptionLines, freezeTouristTax, frozenTouristTaxBaseHt,
      frozenTouristTaxOccupants, frozenTouristTaxRate, frozenTouristTaxTotal, includedGuests, nights,
      normalizedDiscountPercent, persons, platform, platformGrossPin, platformPaidAdults,
      platformPaidOccupants, platformTouristTaxAmountInput, preArrivalOptionsResources,
      resolvedPlatformPaidGuests, settings, storedTouristTaxAddedGuests,
      storedTouristTaxAddedGuestsAdults, teens, touristTaxInComplement, vatRate,
    } = ctx;
    const taxSettings = settings.touristTax;

    // specs/tourist-tax-included-services-deduction.md rules 1-3 — the tax base is the DRY NIGHT: the
    // accommodation charged (the manual « Prix hébergement ajusté » when there is one, otherwise the
    // tariff nights after the discount), minus the reference value of the services structurally
    // included in that rate. The platform brut still does not derive it — that back-solve stays
    // removed (rule 6), which is what keeps the tax out of the brut → finalPrice circle.
    const taxBaseBeforeDeduction = allocateDiscount({
      discount: { percent: normalizedDiscountPercent, customPrice: customFinalPrice, target: 'nights' },
      accommodation: baseAccommodationPrice,
    }).accommodation;
    // Rule 3 — the deducted value is a PER-STAY FORFAIT: the person factor is the guests the rate
    // includes, never the real party. That is the whole difference with the former rule 48, whose
    // `per_person` linen deductions made the declared base shrink as the party grew. `includedGuests`
    // already resolves the locked tariff (rule 12bis), so a sold reservation keeps the factor it had.
    // Only `includedInRate` lines count (property default + offered): a one-off commercial gesture and
    // a custom option are never tagged, so neither is ever deducted (rule 2).
    const taxReferencePersons = includedGuests > 0 ? includedGuests : persons;
    const touristTaxIncludedInRateDeduction = sumIncludedServicesDeduction(
      finalOptionLines.filter((line) => line && line.includedInRate).map((line) => ({
        unitPrice: line.unitPrice,
        units: Number(line.quantity || 0) * getTypeMultiplier(line.priceType, taxReferencePersons, nights),
      })),
    );
    // Tourist-tax routing resolved from the platform's GLOBAL mode (specs/per-platform-tourist-tax-three-way.md).
    // Resolved HERE (before the declared tax base AND the brut back-solve) so both the withheld tax
    // (case 2) and the reversed tax (case 1) can be treated as parts of the brut.
    //   collectsFromGuest               = the platform charges the tax to the guest.
    //   isTouristTaxRemittedByOwnerFlag = WE remit it to the commune (→ « Taxe de séjour » page + 46710000).
    //   platform          (1,1) → OFFERED (zeroed, absent from our books).
    //   platform_reversed (1,0) → CHARGED in the BALANCE; the platform reverses it to us at settlement.
    //   owner             (0,0) → CHARGED at arrival in the COMPLÉMENT.
    //   direct                  → charged in the balance (unchanged).
    const { chargedByPlatform: collectsFromGuest, remittedByOwner: isTouristTaxRemittedByOwnerFlag } = settings.touristTax.collector;
    // OFFERED (struck-through, zeroed) ONLY when the platform both collects it AND remits it itself
    // (case 2). When the platform collects but reverses it to us (case 1), it is NOT offered.
    const isTouristTaxOfferedByPlatform = collectsFromGuest && !isTouristTaxRemittedByOwnerFlag;

    // specs/platform-tourist-tax-out-of-the-commission.md rules 2-3 — in the OFFERED case the operator
    // may state, in euros, the tourist tax the platform kept out of its payout. That amount is the
    // PLATFORM's figure, never ours, which is exactly what makes subtracting it safe where subtracting
    // our own estimate was not (platform-brut-excludes-offered-tourist-tax.md). Empty → 0 → every term
    // below is inert and the brut keeps being read tax-excluded, so no already-booked reservation moves.
    // `Entered` is kept apart from the amount: « 0 € withheld » is the platform's answer, not an empty
    // box, and the fiche must print it instead of falling back to our estimate (spec review 2026-10-27).
    const withheldTouristTaxEntered = platformGrossPin != null && isTouristTaxOfferedByPlatform
      && platformTouristTaxAmountInput !== '' && platformTouristTaxAmountInput != null
      && Number.isFinite(Number(platformTouristTaxAmountInput)) && Number(platformTouristTaxAmountInput) >= 0;
    const withheldTouristTaxInBrut = withheldTouristTaxEntered
      ? roundMoney(Number(platformTouristTaxAmountInput))
      : 0;

    const { taxAccommodationPaid, taxBaseAccommodation, touristTaxBrutInconsistent } = resolveTaxBase({
      platformGrossPin, preArrivalOptionsResources, withheldTouristTaxInBrut, taxBaseBeforeDeduction,
      touristTaxIncludedInRateDeduction, extraGuestInBrutSurcharge,
    });

    const touristTaxBreakdown = computeTouristTaxBreakdown({
      touristTaxMode: taxSettings.mode,
      touristTaxPerDayPerPerson: taxSettings.perPersonNight,
      touristTaxPercentage: taxSettings.percentage,
      touristTaxDepartmentPercentage: taxSettings.departmentPercentage,
      touristTaxFixedAmount: taxSettings.fixedAmount,
      nights,
      adults: Number(adults || 0),
      // specs/tourist-tax-matches-the-office-calculation.md rule 8 — babies are NOT occupants for the
      // divisor. They were, and since dividing by more occupants lowers the tax, every stay with a cot
      // was billed short of what the office's own form computes (checked against the Marchand
      // declaration, filed with 4 occupants where the engine counted 5). The cot still bills its
      // supplement — this is the divisor, not the sale.
      // A frozen stay keeps the divisor it was frozen with (rule 12), so a party edited after
      // collection cannot rewrite the arithmetic behind an amount already paid.
      occupants: freezeTouristTax
        && Number.isFinite(Number(frozenTouristTaxOccupants)) && Number(frozenTouristTaxOccupants) > 0
        ? Number(frozenTouristTaxOccupants)
        : Number(adults || 0) + Number(children || 0) + Number(teens || 0),
      accommodationAmountTtc: taxBaseAccommodation,
      accommodationVatRate: vatRate,
      // Rule 12 — a frozen stay is described by the base it was frozen with, never by a fresh one.
      accommodationAmountHt: freezeTouristTax && frozenTouristTaxBaseHt != null
        && Number.isFinite(Number(frozenTouristTaxBaseHt))
        ? Number(frozenTouristTaxBaseHt)
        : null,
    });
    // specs/tourist-tax-freeze-past-with-refresh.md — for a PAST reservation, freeze the tax AMOUNT to
    // the reservation's stored values (passed in) instead of the recompute. Platform-mode routing below
    // still applies to this frozen amount; only the magnitude is pinned.
    if (freezeTouristTax) {
      touristTaxBreakdown.touristTaxTotal = roundMoney(Number(frozenTouristTaxTotal || 0));
      touristTaxBreakdown.touristTaxRate = Number(frozenTouristTaxRate || 0);
      // With a frozen base the breakdown above already re-derived the €/adulte/nuit FROM that base, and
      // it reproduces the frozen total (rule 14 round-trips). Keep it: it is the figure the caption and
      // the declaration have to show. Without a base — a legacy row the inversion could not rebuild —
      // fall back to the stored rate, which on a percentage property holds the PERCENTAGE, not euros;
      // the declaration derives its own €/adulte/nuit from the amount in that case.
      if (frozenTouristTaxBaseHt == null || !Number.isFinite(Number(frozenTouristTaxBaseHt))) {
        touristTaxBreakdown.touristTaxUnitAmount = Number(frozenTouristTaxRate || 0);
      }
    }
    // specs/platform-added-guests-tourist-tax.md — on a platform that reverses the tax to us, it reversed
    // the tax of the party it sold: what the added guests owe is collected in the complement. Reads the
    // platform's mode, never its name (rule 3). A tax already forced to the complement is whole there.
    let touristTaxAddedGuestsAmount = 0;
    let touristTaxAddedGuestsAdults = 0;
    const resolvedPlatformPaidOccupants = platformPaidOccupants != null && Number.isFinite(Number(platformPaidOccupants))
      ? Number(platformPaidOccupants)
      : resolvedPlatformPaidGuests;
    if (platformGrossPin != null && collectsFromGuest && isTouristTaxRemittedByOwnerFlag
      && !touristTaxInComplement && resolvedPlatformPaidGuests != null
      && platformPaidAdults != null && Number.isFinite(Number(platformPaidAdults))) {
      const storedAdded = roundMoney(Math.max(0, Number(storedTouristTaxAddedGuests || 0)));
      const { paidTotal, added } = resolveAddedGuestsTouristTax({
        touristTaxMode: taxSettings.mode,
        touristTaxPerDayPerPerson: taxSettings.perPersonNight,
        touristTaxPercentage: taxSettings.percentage,
        touristTaxDepartmentPercentage: taxSettings.departmentPercentage,
        touristTaxFixedAmount: taxSettings.fixedAmount,
        nights,
        adults: Number(adults || 0),
        // The live party, even on a frozen stay: only the amount already reversed is pinned (rule 7bis).
        occupants: Number(adults || 0) + Number(children || 0) + Number(teens || 0),
        paidAdults: Number(platformPaidAdults),
        paidOccupants: resolvedPlatformPaidOccupants,
        accommodationAmountTtc: taxBaseAccommodation,
        accommodationVatRate: vatRate,
        accommodationAmountHt: freezeTouristTax && frozenTouristTaxBaseHt != null
          && Number.isFinite(Number(frozenTouristTaxBaseHt))
          ? Number(frozenTouristTaxBaseHt)
          : null,
      });
      // Rule 7 — collected money stops moving, and with it the tax of a later party.
      touristTaxAddedGuestsAmount = complementPaid ? storedAdded : added;
      // Rule 21 — who the amount is for, kept with it: a gap with nobody added (rule 5) holds 0.
      const addedAdults = Math.max(0, Number(adults || 0) - Number(platformPaidAdults));
      if (complementPaid) {
        touristTaxAddedGuestsAdults = storedTouristTaxAddedGuestsAdults != null ? Number(storedTouristTaxAddedGuestsAdults) : addedAdults;
      } else {
        touristTaxAddedGuestsAdults = added > 0 ? addedAdults : 0;
      }
      if (freezeTouristTax) {
        // Rule 7bis — the frozen total holds the added tax of the last save: take it out before adding
        // today's, or every save would count it again.
        touristTaxBreakdown.touristTaxTotal = roundMoney(
          Math.max(0, roundMoney(Number(frozenTouristTaxTotal || 0)) - storedAdded) + touristTaxAddedGuestsAmount,
        );
      } else if (complementPaid) {
        touristTaxBreakdown.touristTaxTotal = roundMoney(paidTotal + storedAdded);
      }
    }
    let touristTaxTotal = touristTaxBreakdown.touristTaxTotal;
    if (isTouristTaxOfferedByPlatform) {
      touristTaxTotal = 0;
    }
    // Case 1 (platform_reversed): the platform charged the guest the tax then reverses it to us, so the
    // brut ALREADY includes it. Count it as a brut line (like a pre-arrival option) and subtract it from
    // the accommodation back-solve — otherwise the tax is BOTH baked into the accommodation AND added
    // again as `totalStayPrice`, over-stating the total/balance and producing a « Paiement plateforme »
    // écart equal to the tax (specs/platform-payment-tourist-tax-as-option.md).
    const touristTaxReversedByPlatform = collectsFromGuest && isTouristTaxRemittedByOwnerFlag && touristTaxTotal > 0;
    // specs/platform-added-guests-tourist-tax.md rule 9 — the added tax was never on the platform's bill.
    const reversedTouristTaxInBrut = (platformGrossPin != null && touristTaxReversedByPlatform)
      ? roundMoney(touristTaxTotal - touristTaxAddedGuestsAmount)
      : 0;

    // The tourist-tax breakdown + platform-mode routing (collectsFromGuest / remitted-by-owner / offered)
    // and the reversed-tax-as-brut handling are resolved earlier, alongside the brut back-solve
    // (specs/platform-payment-tourist-tax-as-option.md). `touristTaxTotal` is final here.

    // Tax collected at check-in (→ "Complément à percevoir") ONLY when WE charge the guest directly,
    // i.e. the platform does NOT collect from the guest (case 3, `owner`). Case 1 (platform collects then
    // reverses to us) is paid by the platform with the settlement → it stays in the BALANCE, not the
    // complement. Direct keeps the historic balance behaviour.
    // Rule 45 of plugins-phase-p-productisation.md — the tax mode is the platform's own setting, so a
    // counts-as-direct channel follows it like any named channel (the accounting export and the SAS
    // recap read it the same way).
    const isTouristTaxCollectedOnArrival = (
      !collectsFromGuest
      && channel.namedChannel
      && touristTaxTotal > 0
    );

    return {
      ...ctx,
      isTouristTaxCollectedOnArrival, isTouristTaxOfferedByPlatform, isTouristTaxRemittedByOwnerFlag,
      resolvedPlatformPaidOccupants, reversedTouristTaxInBrut, taxAccommodationPaid,
      taxBaseAccommodation, taxBaseBeforeDeduction, touristTaxAddedGuestsAdults,
      touristTaxAddedGuestsAmount, touristTaxBreakdown, touristTaxBrutInconsistent,
      touristTaxIncludedInRateDeduction, touristTaxReversedByPlatform, touristTaxTotal,
      withheldTouristTaxEntered, withheldTouristTaxInBrut,
    };
  },
};

module.exports = step;
