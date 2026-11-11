/**
 * One row of the quotes list (`GET /api/devis`), ready to render
 * (specs/ui-review-2026-10-19-operations.md rules 5 and 9).
 *
 *   - `totalTtc` — what the guest owes on the quote: the stay price plus the tourist tax, both stored
 *     by the engine. The list used to add them up in the page.
 *   - the origin badge — a website request that carried no attribution would print « Origine
 *     inconnue » on every row, which tells nothing the « Site internet » badge does not. The list drops
 *     it; the quote fiche keeps the full origin (specs/site-traffic-analytics.md rule 19).
 *   - `expired` / `extendable` — a quote past its validity reads « Périmé » in the list, and its PDF
 *     is only downloaded after a confirmation (rule 21).
 *
 * Pure.
 */
const { roundMoney } = require('./devisHelpers');
const { originDisplay } = require('./attributionChannel');
const { isDevisExpired, isDevisExtendable } = require('./devisValidity');

function devisListRow(row, todayIso) {
  const origin = row && row.attributionChannel ? originDisplay(row) : { originLabel: null, originDetail: null };
  return {
    ...row,
    ...origin,
    totalTtc: roundMoney(Number(row?.finalPrice || 0) + Number(row?.touristTaxTotal || 0)),
    // A converted quote is a reservation now: never « Périmé ».
    expired: row?.devisStatus !== 'converted' && isDevisExpired(row?.validUntil, todayIso),
    extendable: isDevisExtendable(row, todayIso),
  };
}

module.exports = { devisListRow };
