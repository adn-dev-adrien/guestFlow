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
const { calculateReservationQuote } = require('./pricing');
const { buildReservationEngineInput } = require('./reservationEngineInput');
const quotePostProcessors = require('./quotePostProcessors');
const { midStayQuoteInputs, resolvePlatformTakesDeposit, resolvePlatformPayoutDueDays } = require('./reservationQuoteContext');

function quoteStoredReservation(db, reservation, overrides = {}) {
  const engineInput = {
    ...buildReservationEngineInput(db, reservation),
    platformTakesDeposit: resolvePlatformTakesDeposit(reservation.platform),
    platformPayoutDueDays: resolvePlatformPayoutDueDays(reservation.platform),
    ...midStayQuoteInputs(db, reservation.id),
    ...overrides,
  };
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
    // A custom line is the operator's own text and amount: renaming it, or retyping the amount of an
    // offered one, is an edit even though nothing is billed differently.
    ...(line.customOptionId != null || line.isCustom
      ? { title: String(line.title || line.description || ''), originalTotalPrice: Math.round(Number(line.originalTotalPrice ?? line.totalPrice ?? 0) * 100) }
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

module.exports = { quoteStoredReservation, pricingUnchangedFromStored, pinStoredPricing };
