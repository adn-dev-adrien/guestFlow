/**
 * The departure recap payload (specs/sas-departure-recap-server-side.md §4.3) — what the dialog
 * renders, shaped from a plan of `reservationsModel.planDepartureSas`. Pure: every input is handed in.
 *
 *   plan             — the plan (lines, totals, recall, adjusted)
 *   nothingToCollect — the server's « Rien à percevoir » answer for the stored buckets
 */

const sdk = require('../sdk');

const { round2 } = sdk.coreModule('departureSasPlan');

function shapeDepartureRecap(plan, { nothingToCollect = false } = {}) {
  const grandTotal = round2(plan.grandTotal);
  return {
    lines: plan.lines,
    endOfStayTotal: round2(plan.endOfStayTotal),
    extinguisherTotal: round2(plan.extinguisherTotal),
    recall: plan.recall,
    grandTotal,
    settleable: grandTotal > 0,
    nothingToCollect: Boolean(nothingToCollect) && grandTotal <= 0,
    endOfStayPaid: plan.endOfStayPaid,
    midStaySettled: round2(plan.midStaySettled),
    adjusted: plan.adjusted,
  };
}

module.exports = { shapeDepartureRecap };
