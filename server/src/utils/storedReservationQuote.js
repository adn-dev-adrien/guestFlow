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

// `customKey` is the browser's handle on a custom line, not part of its price.
function withoutClientKeys(quote) {
  return { ...quote, optionLines: (quote.optionLines || []).map(({ customKey, ...line }) => line) };
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
function pricingUnchangedFromStored(db, stored, quote) {
  try {
    const replay = quoteStoredReservation(db, stored);
    return Boolean(replay && !replay.error && isDeepStrictEqual(withoutClientKeys(replay), withoutClientKeys(quote)));
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
