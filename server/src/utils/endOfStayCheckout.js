/**
 * D20 (Adrien, 2026-11-06) — the end-of-stay complement is collected once the guest has left
 * (specs/reservation-payment-ledger.md rule 68).
 *
 * « Check-out done » is the departure SAS committed (`departureSasDoneAt`) when the sas plugin is live;
 * without it, the last day of the stay has come (server local day, Europe/Paris, utils/localDate).
 * Every path that would mark the end-of-stay complement collected asks `endOfStayCollectRefusal` first;
 * the departure SAS, which IS the check-out, is the one writer that does not.
 *
 * Pure apart from the default `sasActive` (the plugin registry) and `today` (the server clock).
 */

const { todayIso } = require('./localDate');

const END_OF_STAY_BEFORE_CHECKOUT = 'END_OF_STAY_BEFORE_CHECKOUT';
const END_OF_STAY_BEFORE_CHECKOUT_MESSAGE = 'Complément de fin de séjour encaissable après le départ.';
// The caption under the closed mark of the fiche, where the row already names the complement.
const END_OF_STAY_BEFORE_CHECKOUT_CAPTION = 'Après le départ.';

function sasLive() {
  try { return require('../plugins/sdk/registry').isLive('sas'); } catch { return false; }
}

/** Whether the stay is checked out, so its end-of-stay complement may be collected. */
function isCheckoutDone(row, { today = todayIso(), sasActive = sasLive() } = {}) {
  if (!row) return false;
  if (sasActive) return Boolean(row.departureSasDoneAt);
  const end = String(row.endDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(end) && String(today).slice(0, 10) >= end;
}

const endOfStaySettled = (row) => Number((row && row.endOfStayComplementPaid) || 0) === 1
  || Number((row && row.endOfStayComplementPaidCash) || 0) === 1;

/** The 409 answered to a mark of the end-of-stay complement before the check-out, or null. */
function endOfStayCollectRefusal(row, options = {}) {
  if (isCheckoutDone(row, options)) return null;
  return { status: 409, body: { error: END_OF_STAY_BEFORE_CHECKOUT_MESSAGE, code: END_OF_STAY_BEFORE_CHECKOUT } };
}

module.exports = {
  END_OF_STAY_BEFORE_CHECKOUT,
  END_OF_STAY_BEFORE_CHECKOUT_MESSAGE,
  END_OF_STAY_BEFORE_CHECKOUT_CAPTION,
  isCheckoutDone,
  endOfStaySettled,
  endOfStayCollectRefusal,
};
