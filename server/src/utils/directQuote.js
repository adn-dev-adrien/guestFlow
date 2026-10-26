/**
 * The quote of the website for a stay: the engine (`calculateReservationQuote`) on the direct channel,
 * with the property's DEFAULT options merged in. Moved out of the website-booking plugin unchanged so
 * that every reader of « the price the site charges » calls the same code
 * (specs/google-vacation-rentals-feed.md rule 4): the public quote and booking request of
 * website-booking, and the Google Vacation Rentals feed. Exposed to plugins as `coreModule('directQuote')`.
 */

// deps: { db, calculateReservationQuote, getTodayIsoDate, optionsModel, propertyOptionDefaultsModel,
// mergePropertyDefaultsIntoPayload, isPerPersonCardOption }. The website-booking plugin binds them to
// the modules it already reaches through the SDK; `buildEngineQuote` below is bound to the core's own.
function createDirectQuote({
  db, calculateReservationQuote, getTodayIsoDate, optionsModel, propertyOptionDefaultsModel,
  mergePropertyDefaultsIntoPayload, isPerPersonCardOption,
}) {
  /**
   * The quantity a property DEFAULT takes on the public flow: one portion per guest for a per-person
   * card option (specs/site-meal-portions.md rule 5), 1 for everything else.
   */
  function defaultPortionQuantity(input, optionId) {
    const option = optionsModel.listForProperty(Number(input.propertyId))
      .find((o) => Number(o.id) === Number(optionId));
    if (!isPerPersonCardOption(option)) return 1;
    return Math.max(1, Number(input.adults || 1) + Number(input.children || 0) + Number(input.teens || 0));
  }

  function buildEngineQuote(input) {
    // Apply the property's DEFAULT options (paid → added, offered → free) the SAME way the booking-request
    // devis does, so the live preview matches the price the guest will actually be charged. The offered
    // ids come ONLY from the server-side defaults — never from client input (no price manipulation).
    // Engine-managed auto-options (early/late check, baby-bed supplement) are DERIVED from the stay
    // itself and must never arrive as a client-chosen line: the engine drops its own line when the id
    // is already selected, so honouring the payload would let a visitor set the quantity — and the
    // price — of a supplement they don't get to choose. Same filter as `devisModel.computeQuote`, so
    // the live quote and the devis the request creates agree (specs/baby-bed-supplement.md §3.5 rule 18).
    const engineManagedAutoIds = new Set(
      optionsModel.listForProperty(Number(input.propertyId))
        .filter((o) => o.autoOptionType && Number(o.autoEnabled || 0) === 1)
        .map((o) => Number(o.id)),
    );
    const merged = mergePropertyDefaultsIntoPayload(
      {
        selectedOptions: input.options
          .filter((o) => !engineManagedAutoIds.has(Number(o.optionId)))
          .map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
        offeredOptionIds: [],
      },
      Number(input.propertyId),
      propertyOptionDefaultsModel,
      { quantityFor: (optionId) => defaultPortionQuantity(input, optionId) },
    );
    return calculateReservationQuote({
      db,
      propertyId: input.propertyId,
      // specs/payment-schedule-and-cancellation.md §3.1 — a public quote is a booking happening now:
      // the acompte is due `depositDueDays` from today and the solde is clamped to today at the
      // earliest, so the site shows the deadlines the reservation will actually carry.
      bookingDate: getTodayIsoDate(),
      startDate: input.startDate,
      endDate: input.endDate,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      adults: input.adults,
      children: input.children,
      teens: input.teens,
      babies: input.babies,
      // specs/baby-bed-supplement.md §3.5 — the site bills the cot like the fiche does. No `bookingId`:
      // a public quote is always a booking that does not exist yet.
      babyBeds: input.babyBeds,
      selectedOptions: merged.selectedOptions,
      offeredOptionIds: merged.offeredOptionIds,
      selectedResources: (input.resources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
      platform: 'direct',
      // Public/site flow: planning-card options are billed by quantity (unschedulable on the site) —
      // the operator fixes the slots later (specs/public-planning-options.md). A per-person one counts
      // portions, capped by what the stay can serve (specs/site-meal-portions.md).
      planningCardAsQuantity: true,
      // The insurance price a plugin sets (specs/plugins-phase-3b-neat.md rule 2) — absent on the first run.
      cancellationInsurancePriceOverride: input.cancellationInsurancePriceOverride,
    });
  }

  return { buildEngineQuote, defaultPortionQuantity };
}

let coreBound = null;
function bound() {
  if (!coreBound) {
    coreBound = createDirectQuote({
      db: require('../database'),
      calculateReservationQuote: require('./pricing').calculateReservationQuote,
      getTodayIsoDate: (...args) => require('./reservationHelpers').getTodayIsoDate(...args),
      optionsModel: require('../models/optionsModel'),
      propertyOptionDefaultsModel: require('../models/propertyOptionDefaultsModel'),
      mergePropertyDefaultsIntoPayload: require('./propertyDefaultOptions').mergePropertyDefaultsIntoPayload,
      isPerPersonCardOption: require('./mealPortions').isPerPersonCardOption,
    });
  }
  return coreBound;
}

module.exports = {
  createDirectQuote,
  buildEngineQuote: (input) => bound().buildEngineQuote(input),
  defaultPortionQuantity: (input, optionId) => bound().defaultPortionQuantity(input, optionId),
};
