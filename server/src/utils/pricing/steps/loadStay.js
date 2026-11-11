/**
 * STEP loadStay — LOADER (specs/pricing-components.md §3 rule 52).
 *
 * Spreads the engine input (with what the loader read, `models/pricingInputModel.js`) into the context and
 * derives the stay's party and channel.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { isDirectChannel } = require('../../platformNameFormat');
const { saleChannel } = require('../../saleChannel');

const step = {
  id: 'loadStay',
  requires: ['input'],
  provides: [
    'property', 'vatRegime', 'vatRate', 'rules', 'optionsById', 'resourcesById', 'defaultOfferedOptionIds',
    'platformTaxRow', 'billableBabyBeds', 'paymentLedger', 'startDate', 'endDate', 'checkInTime', 'checkOutTime',
    'adults', 'children', 'teens', 'babies', 'babyBeds', 'bookingId', 'discountPercent', 'customPrice',
    'selectedOptions', 'customOptions', 'selectedResources', 'depositPaid', 'balancePaid', 'complementPaid',
    'depositAmount', 'balanceAmount', 'complementAmount', 'offeredOptionIds', 'extraGuestSurchargeOffered',
    'lockedOptionUnits', 'lockedResourceUnits', 'lockedNightlyBreakdown', 'lockedTariff', 'lockedOptionLines',
    'lockedResourceLines', 'platform', 'depositDisabled', 'depositAmountOverride', 'complementAmountOverride',
    'touristTaxInComplement', 'autoOptionsInComplement', 'freezeTouristTax', 'paidSoldeCaptured',
    'frozenTouristTaxTotal', 'frozenTouristTaxRate', 'frozenTouristTaxBaseHt', 'frozenTouristTaxOccupants',
    'frozenTouristTaxAt', 'platformCommissionAmountInput', 'acompteCommissionAmountInput', 'platformTakesDeposit',
    'platformPayoutDueDays', 'platformGrossAmountInput', 'platformPaidAdults', 'platformPaidOccupants',
    'storedTouristTaxAddedGuests', 'storedTouristTaxAddedGuestsAdults', 'platformPaidGuests',
    'platformTouristTaxAmountInput', 'planningCardAsQuantity', 'endOfStaySasAmount', 'endOfStaySasAmountAuto',
    'endOfStayComplementSettled', 'frozenMidStayLines', 'midStaySettledNotes', 'refundsTotal',
    'platformPenaltyAmount', 'arrivalPaymentReduction', 'arrivalPaymentTip', 'complementDeferredToCheckout',
    'complementCollected', 'quoteKind', 'validUntil', 'devisPromise', 'cancellationInsurancePriceOverride',
    'channel', 'isDirectBooking', 'persons',
  ],
  apply(ctx) {
    const {
      property,
      vatRegime,
      vatRate,
      rules,
      optionsById,
      resourcesById,
      defaultOfferedOptionIds,
      platformTaxRow,
      billableBabyBeds,
      paymentLedger,
      startDate,
      endDate,
      checkInTime,
      checkOutTime,
      adults,
      children,
      teens,
      babies,
      // specs/baby-bed-supplement.md — the cots entered on the booking. They are NOT guests (babies are
      // already counted apart) : they drive one derived option line, `price × babyBeds` for the stay.
      babyBeds,
      // The SAVED booking this quote is for (a reservation OR a devis — same table), absent on a booking
      // that does not exist yet. Read by the baby-bed rule only, to leave every booking taken before the
      // supplement existed strictly untouched (specs/baby-bed-supplement.md §3.3).
      bookingId,
      discountPercent,
      customPrice,
      selectedOptions,
      customOptions,
      selectedResources,
      depositPaid,
      balancePaid,
      complementPaid,
      depositAmount,
      balanceAmount,
      complementAmount,
      offeredOptionIds,
      extraGuestSurchargeOffered,
      lockedOptionUnits,
      lockedResourceUnits,
      lockedNightlyBreakdown,
      lockedTariff = null,
      lockedOptionLines,
      lockedResourceLines,
      platform,
      // Admin opt-out of the deposit/balance split (see specs/disable-deposit-per-reservation.md).
      // When truthy, the engine forces depositAmount=0 and lets the balance absorb the whole
      // pre-arrival total — survives every recompute as long as the caller keeps passing it.
      depositDisabled,
      // Operator-set manual deposit (specs/editable-deposit-amount.md). NULL/''/undefined = automatic
      // (percentage of pre-arrival). When a number is provided, the engine freezes the deposit at that
      // value (clamped to [0, preArrival]) and lets the balance absorb the rest — so a later tariff
      // change grows the solde, never the acompte. Direct + non-disabled + not-yet-paid only; the
      // platform / depositDisabled / paid branches keep precedence over it.
      depositAmountOverride,
      // Operator-set complement (specs/adjustable-complement-amounts.md §3.2). NULL/''/undefined =
      // automatic. A value wins over EVERY branch below, frozen bucket included: the whole point is to
      // correct an amount that was announced — and therefore collected — wrong.
      complementAmountOverride,
      // Per-item routing to Complément (spec force-item-to-complement.md). When 1, the tax bypasses
      // the auto deposit/balance split and lands 100 % in the complément bucket. `selectedOptions[i]
      // .inComplement` / `selectedResources[i].inComplement` / `customOptions[i].inComplement` drive
      // the same routing per line.
      touristTaxInComplement,
      // Override list (array of optionId) for auto-options (early check-in, late check-out, ...).
      // Auto-options are not part of `selectedOptions` (the engine derives them from
      // `option.autoEnabled = 1`), so their `inComplement` flag travels through this parallel
      // signal. The client builds it from a dedicated form field; on load, it's hydrated by
      // reading the auto-options that already have `inComplement = 1` in `reservation_options`.
      autoOptionsInComplement,
      // specs/tourist-tax-freeze-past-with-refresh.md — when truthy, the tourist tax AMOUNT is frozen to
      // the provided `frozenTouristTaxTotal` / `frozenTouristTaxRate` (the reservation's stored values)
      // instead of being recomputed from current property settings. Used for PAST reservations so a later
      // commune-rate / nightly-price change never silently rewrites an already-declared tax. The routing
      // (offered / balance / complément) still applies to that frozen amount.
      freezeTouristTax,
      // specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-05 (D9) — the solde's contribs are
      // captured: proof the buckets agreed when it was paid (scheduleQuoteInputs).
      paidSoldeCaptured = false,
      frozenTouristTaxTotal,
      frozenTouristTaxRate,
      // specs/tourist-tax-matches-the-office-calculation.md rule 12 — the base (HT, whole stay), the
      // divisor and the €/adulte/nuit the frozen amount was computed with, stored alongside it. The
      // fiche and the declaration render these, so a frozen line reproduces its own amount in the
      // office's form instead of showing a base recomputed under whatever rule is current.
      frozenTouristTaxBaseHt,
      frozenTouristTaxOccupants,
      frozenTouristTaxAt,
      // specs/platform-commission-line.md + platform-per-echeance-commission.md — the platform commission on
      // the SOLDE, operator-entered (€, TTC). Non-direct only. Books on the platform account on the balance
      // entry; the acompte has its own `acompteCommissionAmount` below.
      platformCommissionAmount: platformCommissionAmountInput,
      // specs/platform-per-echeance-commission.md — the platform commission on the ACOMPTE (€, TTC), operator-
      // entered. Books on the platform account on the deposit entry. Net perçu = total − (acompte + solde).
      acompteCommissionAmount: acompteCommissionAmountInput,
      // specs/platform-deposit-toggle.md — GLOBAL per-platform "takes an acompte?" flag (the controller
      // resolves it from the platforms table by name). Falsy (default) → the platform keeps the legacy
      // single-payment behaviour (deposit=0, all in the solde). Truthy → the platform's reservations use the
      // normal acompte/solde split of the GROSS pre-arrival.
      platformTakesDeposit,
      // specs/platform-payout-due-date.md — GLOBAL per-platform payout delay in days (the controller
      // resolves it from the platforms table by name, same as the flag above). Drives the solde deadline
      // of a NON-direct reservation: `balanceDueDate = endDate + platformPayoutDueDays`. Ignored on an
      // own channel (direct / Lodgify), which keeps the J-30 rule.
      platformPayoutDueDays,
      // specs/platform-payment-entry.md — the gross the guest paid the platform. When set on a non-direct
      // reservation it PINS the total séjour: finalPrice = platformGrossAmount, the accommodation absorbing
      // the remainder (brut − options − resources − extra-guest). Empty / direct → normal pricing.
      platformGrossAmount: platformGrossAmountInput,
      // specs/platform-added-guests-tourist-tax.md rules 1, 7 — the adults the platform billed (server-owned)
      // and the added tax as last stored, which a collected complement or a frozen total already contains.
      platformPaidAdults,
      platformPaidOccupants,
      storedTouristTaxAddedGuests,
      storedTouristTaxAddedGuestsAdults,
      // specs/platform-extra-guest-complement.md — the persons the platform billed (server-owned).
      platformPaidGuests = null,
      // specs/platform-tourist-tax-out-of-the-commission.md — the tourist tax the platform withheld from
      // its payout and remits to the commune itself, as the PLATFORM computed it (€, operator-entered).
      // Only read alongside a brut on a platform in mode « collecte ET reverse ». Empty → the brut is
      // read tourist-tax-excluded, which is the pre-existing convention and every stored reservation.
      platformTouristTaxAmount: platformTouristTaxAmountInput,
      // specs/public-online-deposit.md → public-planning-options.md — the PUBLIC/site flow can't schedule
      // a planning-card option's slots, so the visitor's QUANTITY is what gets billed and the line stays
      // unscheduled. Since specs/unscheduled-card-option.md rule 4 this flag no longer decides whether
      // such a line EXISTS — every flow now bills an unplaced card option rather than dropping it — it
      // only carries the public portion cap + clamp (specs/site-meal-portions.md rule 3), which must
      // never apply to an operator.
      planningCardAsQuantity,
      // Σ of the end-of-stay detail lines the departure SAS owns (ménage, linge manquant, extincteur…),
      // i.e. the stored complement MINUS the mid-stay lines. Added back to expose the end-of-stay total.
      endOfStaySasAmount,
      endOfStaySasAmountAuto,
      // Once the end-of-stay complement is collected its amount is frozen: the mid-stay split stops
      // moving and the STORED lines are used instead of a fresh computation, so what was collected is
      // still carved out of the other buckets but never re-priced (§3.5).
      endOfStayComplementSettled,
      frozenMidStayLines,
      // specs/mid-stay-notes.md §3.3 — the « notes en séjour » register: prestations already COLLECTED
      // during the stay. Deducted from the end-of-stay remainder, but still carved out of the frozen
      // pre-arrival buckets — money in the till never flows back into the acompte/solde/complément.
      midStaySettledNotes,
      // specs/reservation-refunds.md §3.3 rule 17 — book-money already given back to the guest. The engine
      // only subtracts it from the displayed « total de séjour »: the sale, the échéances and the buckets
      // are deliberately untouched by a refund.
      refundsTotal = 0,
      // specs/reconciliation-assisted-matching.md rule 27 — what the platform kept on the payout besides its
      // commission: lowers « Vous percevez » exactly like a commission, without ever being one (read from the stored row).
      platformPenaltyAmount = 0,
      // specs/arrival-payment-detail-and-adjustment.md rules 20-21 — the single arrival payment was made
      // for LESS than its buckets add up to (a réduction accordée on the accommodation) or for more (a
      // pourboire). Like a refund, the engine only moves the displayed « total du séjour » with it: no
      // bucket, no échéance and no price is re-derived, which is what keeps a settled schedule settled.
      arrivalPaymentReduction = 0,
      arrivalPaymentTip = 0,
      // specs/defer-arrival-complement-to-checkout.md §3.3 rule 16 — the operator moved the arrival
      // complement to the door. Files it under « fin de séjour » in the split even before the stay starts.
      complementDeferredToCheckout = false,
      // Whether the arrival complement is collected, FOR THE SPLIT ONLY. `complementPaid` cannot serve
      // here: the live-preview handler deliberately omits it (passing it would freeze the amount), so the
      // preview would file a collected complement under « fin de séjour ». The save passes the operator's
      // intent via `complementPaid`, which wins; the preview falls back to this stored value.
      complementCollected,
      // 'reservation' (default) | 'devis'. A devis takes `validUntil` as its acompte deadline (rule 5).
      kind: quoteKind = 'reservation',
      validUntil = null,
      // D23 (specs/deposit-blocks-the-dates.md rule 19) — on a reservation converted from a devis: that devis's
      // start date and validity date, `{ startDate, validUntil }`. Null everywhere else.
      devisPromise = null,
      // specs/neat-cancellation-insurance-subscription.md §3.2 rule 13 — the Neat-derived guest price
      // of the cancellation insurance, for the WHOLE stay (premium + margin, euro-ceiled), resolved
      // asynchronously by the caller BEFORE invoking the engine. When a finite number, it replaces the
      // flagged option's catalogue tariff (unit price × 1, whatever the price type); the locked
      // snapshot of a sold line still wins over it. Null/absent → the catalogue tariff as before.
      cancellationInsurancePriceOverride = null,
    } = ctx.input;

    const persons = (Number(adults || 1) || 1) + (Number(children || 0) || 0) + (Number(teens || 0) || 0);
    // Resolved here (the fuller platform routing lives further down) because the option lines above
    // need it for the included-units rule (specs/tariff-recipes/spec.md §3.9 rule 52bis).
    const isDirectBooking = isDirectChannel(platform);
    // specs/plugins-phase-p-productisation.md rule 45 — the one reading of the channel every money
    // decision below shares.
    const channel = saleChannel(platform);

    return {
      ...ctx,
      acompteCommissionAmountInput, adults, arrivalPaymentReduction, arrivalPaymentTip,
      autoOptionsInComplement, babies, babyBeds, balanceAmount, balancePaid, billableBabyBeds, bookingId,
      cancellationInsurancePriceOverride, channel, checkInTime, checkOutTime, children, complementAmount,
      complementAmountOverride, complementCollected, complementDeferredToCheckout, complementPaid,
      customOptions, customPrice, defaultOfferedOptionIds, depositAmount, depositAmountOverride,
      depositDisabled, depositPaid, devisPromise, discountPercent, endDate, endOfStayComplementSettled,
      endOfStaySasAmount, endOfStaySasAmountAuto, extraGuestSurchargeOffered, freezeTouristTax,
      frozenMidStayLines, frozenTouristTaxAt, frozenTouristTaxBaseHt, frozenTouristTaxOccupants,
      frozenTouristTaxRate, frozenTouristTaxTotal, isDirectBooking, lockedNightlyBreakdown,
      lockedOptionLines, lockedOptionUnits, lockedResourceLines, lockedResourceUnits, lockedTariff,
      midStaySettledNotes, offeredOptionIds, optionsById, paidSoldeCaptured, paymentLedger, persons,
      planningCardAsQuantity, platform, platformCommissionAmountInput, platformGrossAmountInput,
      platformPaidAdults, platformPaidGuests, platformPaidOccupants, platformPayoutDueDays,
      platformPenaltyAmount, platformTakesDeposit, platformTaxRow, platformTouristTaxAmountInput,
      property, quoteKind, refundsTotal, resourcesById, rules, selectedOptions, selectedResources,
      startDate, storedTouristTaxAddedGuests, storedTouristTaxAddedGuestsAdults, teens,
      touristTaxInComplement, validUntil, vatRate, vatRegime,
    };
  },
};

module.exports = step;
