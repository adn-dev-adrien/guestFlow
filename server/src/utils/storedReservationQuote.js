/**
 * The quote of a STORED stay, exactly as its fiche would price it on a save: the shared engine input
 * (`reservationEngineInput`) plus the context only the application's models know (the platform's acompte
 * and payout settings, the mid-stay state), the engine, then the quote post-processors a plugin declares (the
 * cancellation insurance). The one entry point for everything that needs « what is this stay worth
 * now » without a browser — installment plans, restamped buckets, the trop-perçu baseline, the contrib
 * capture, the tourist-tax declaration.
 *
 * `overrides` replace engine inputs for a caller that asks a different question of the same stay (the
 * tax declaration pins the freeze, a regime switch asks for another period); they never replace the
 * stored stay itself.
 *
 * A quote post-processor calls the plugin's own snapshot builder, which replays through
 * `buildReservationEngineInput` and NOT through this module: the processor must never re-enter itself.
 */
const { isDeepStrictEqual } = require('node:util');
const { calculateReservationQuote, calculateTouristTaxFigure } = require('./pricing');
const { buildReservationEngineInput } = require('./reservationEngineInput');
const quotePostProcessors = require('./quotePostProcessors');
const { toCents } = require('./pricing/money');
const { midStayQuoteInputs, resolvePlatformTakesDeposit, resolvePlatformPayoutDueDays } = require('./reservationQuoteContext');

function storedEngineInput(db, reservation, overrides = {}) {
  return {
    ...buildReservationEngineInput(db, reservation),
    platformTakesDeposit: resolvePlatformTakesDeposit(reservation.platform),
    platformPayoutDueDays: resolvePlatformPayoutDueDays(reservation.platform),
    ...midStayQuoteInputs(db, reservation.id),
    ...overrides,
  };
}

// The tax figures a stored stay shows (`touristTaxOriginalTotal`, `platformTouristTaxWithheld`), from the TOURIST TAX slice.
function touristTaxFigureOfStoredReservation(db, reservation, overrides = {}) {
  return calculateTouristTaxFigure(storedEngineInput(db, reservation, overrides));
}

function quoteStoredReservation(db, reservation, overrides = {}) {
  const engineInput = storedEngineInput(db, reservation, overrides);
  const quote = calculateReservationQuote(engineInput);
  if (!quote || quote.error) return quote;
  return quotePostProcessors.applySync({ engineInput, quote, calculate: calculateReservationQuote });
}

// The columns of a stay a save writes from the engine's money figures.
const PRICING_COLUMNS = [
  'totalPrice', 'touristTaxRate', 'touristTaxTotal', 'discountPercent', 'finalPrice', 'depositAmount',
  'depositDueDate', 'balanceAmount', 'balanceDueDate', 'complementAmount', 'platformCommissionAmount',
  'acompteCommissionAmount',
];

// What a line bills, not how the engine got there: its identity, units, amounts and routing. An
// engine-derived auto-option comes back as a plain locked line from the replay and as a derived one
// (with its hours and mode) from the save; the unit price of an offered line is informational.
// `customKey` is the browser's handle on a custom line.
function billedLine(line) {
  const offered = Number(line.offered || 0) === 1 || line.offered === true;
  return {
    id: line.customOptionId != null ? `custom:${line.customOptionId}` : (line.optionId != null ? `option:${line.optionId}` : `resource:${line.resourceId}`),
    quantity: Number(line.quantity || 0),
    billedUnits: Number(line.billedUnits || 0),
    unitPrice: offered ? null : Math.round(Number(line.unitPrice || 0) * 100),
    totalPrice: Math.round(Number(line.totalPrice || 0) * 100),
    offered,
    inComplement: Number(line.inComplement || 0),
    // The amount typed on a custom line is an input even when the line is offered; its TEXT is not
    // (Adrien, 2026-10-29: a rename saves the text only, nothing is re-priced).
    ...(line.customOptionId != null || line.isCustom
      ? { originalTotalPrice: Math.round(Number(line.originalTotalPrice ?? line.totalPrice ?? 0) * 100) }
      : {}),
    sessions: line.sessions || null,
    cardOccurrences: line.cardOccurrences || null,
    cardPersons: line.cardPersons || null,
  };
}

// Every figure a save would write from the engine: the money columns, the lines, the nights.
const PRICED_FIGURES = [
  ...PRICING_COLUMNS, 'totalStayPrice', 'optionsTotal', 'resourcesTotal', 'extraGuestSurcharge', 'complementAmountAuto',
  'endOfStayComplementTotal', 'midStayExtrasLines', 'overCollectedTtc',
];

function pricedProjection(quote) {
  const figures = Object.fromEntries(PRICED_FIGURES.map((key) => [key, quote[key]]));
  return {
    figures,
    optionLines: (quote.optionLines || []).map(billedLine).sort((a, b) => a.id.localeCompare(b.id)),
    resourceLines: (quote.resourceLines || []).map(billedLine).sort((a, b) => a.id.localeCompare(b.id)),
    nights: (quote.nightlyBreakdown || []).map((n) => [n.date, Math.round(Number(n.price || 0) * 100)]),
  };
}

/**
 * Did the save change anything the price depends on? The quote of the posted fiche is compared with the
 * quote of the stored stay, both by the SAME engine: when they are identical no pricing input moved, and
 * the stored figures stand — the engine of today may disagree with the engine that priced the stay
 * (a catalogue edited, a rule changed since), and a save that touched nothing must not carry that
 * drift into the money columns, the line snapshots or the history (audit 2026-10-28).
 *
 * A replay that cannot run reads as « changed »: the save then prices the stay as it always did.
 */
function pricingUnchangedFromStored(db, stored, quote, overrides = {}) {
  try {
    const replay = quoteStoredReservation(db, stored, overrides);
    return Boolean(replay && !replay.error && isDeepStrictEqual(pricedProjection(replay), pricedProjection(quote)));
  } catch {
    return false;
  }
}

// The quote with the money figures the stay already carries.
function pinStoredPricing(quote, stored) {
  const pinned = { ...quote };
  for (const column of PRICING_COLUMNS) pinned[column] = stored[column];
  return pinned;
}

// specs/pricing-components.md rule 30 (owner 2026-11-15) — a sale, a line changed or a line removed moves only the money of its line. `base` is the
// row the same engine gives the stored stay before the gesture: the difference `quote − base` is what the gesture moved, and it is added to what the
// stay stores. The figures no line moves (the tax, its rate, the discount, the deadlines, the commissions) stay the stored ones, whatever the engine of
// today would make of them (a platform's tax mode changed since, a stay stored at a figure the engine no longer reproduces).
const SALE_DELTA_COLUMNS = ['totalPrice', 'finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount'];
const PINNED_BUCKETS = ['depositAmount', 'balanceAmount', 'complementAmount'];
const SALE_STORED_COLUMNS = PRICING_COLUMNS.filter((column) => !SALE_DELTA_COLUMNS.includes(column));

function pinSaleDelta(quote, stored, base) {
  const pinned = { ...quote };
  for (const column of SALE_DELTA_COLUMNS) pinned[column] = (toCents(stored[column]) + toCents(quote[column]) - toCents(base[column])) / 100;
  // Rule 104 (loop t4, S4-3) — a bucket the gesture lowers stops at 0: a paid line's money the engine credited to a complement or a plan bucket
  // the stay does not store (a figure it no longer reproduces) is money received beyond the total, the trop-perçu rule 23 confirms.
  for (const column of PINNED_BUCKETS) if (pinned[column] < 0 && toCents(quote[column]) < toCents(base[column])) pinned[column] = 0;
  for (const column of SALE_STORED_COLUMNS) pinned[column] = stored[column];
  if (quote.complementAmountAuto != null) {
    pinned.complementAmountAuto = (toCents(quote.complementAmountAuto) + toCents(stored.complementAmount) - toCents(base.complementAmount)) / 100;
  }
  // The instalment plan follows the pinned plan bucket, never the engine's restated one (rule 93: a sale never rewrites a plan the stay stores at its own figure).
  if (quote.preArrivalAmount != null && base.preArrivalAmount != null) {
    pinned.preArrivalAmount = (toCents(stored.depositAmount) + toCents(stored.balanceAmount) + toCents(quote.preArrivalAmount) - toCents(base.preArrivalAmount)) / 100;
  }
  return pinned;
}

module.exports = {
  quoteStoredReservation, touristTaxFigureOfStoredReservation, pricingUnchangedFromStored, pinStoredPricing, pinSaleDelta, SALE_DELTA_COLUMNS,
};
