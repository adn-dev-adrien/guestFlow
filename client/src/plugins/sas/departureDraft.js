/**
 * departureDraft — the departure SAS decisions as the server reads them (specs/sas-departure-recap-server-side.md
 * rule 4): ONE object, sent to the preview while the operator works and, with the settlement, to the
 * commit at the end. Intent only — no amount, no total, no price (rules 6-9, 13): the server prices
 * everything, and keeps the stored lines the draft only refers to.
 *
 * Input (all from the dialog's local state):
 *   cleaningOk        — the end-of-stay ménage answer: false = « Pas OK » (billed)
 *   missingDep        — { [linenItemId]: qty } chosen on « Éléments manquants »
 *   extinguisherCheck — does the SAS check the extinguisher at all (the plugin setting)
 *   extinguisherOk    — the extinguisher answer; false opens the tariff page
 *   extinguisherQty   — { [repairKey]: qty } chosen on the tariff page
 *   extinguisherKeys  — the repair keys of the extinguisher tariffs
 *   storedKeys        — the keys the server issued for the stored lines this run carries
 *   offered           — Set of offer keys (« Offrir »)
 */

const RECALLED_REF = /^(option|resource|custom|extraGuests):(\d+)$/;

export default function buildDepartureDraft({
  cleaningOk = null, missingDep = {}, extinguisherCheck = false, extinguisherOk = true,
  extinguisherQty = {}, extinguisherKeys = [], storedKeys = [], offered = new Set(),
}) {
  return {
    cleaningCharged: cleaningOk === false,
    cleaningOffered: offered.has('depCleaning'),
    missingItems: Object.entries(missingDep)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([itemId, qty]) => ({ itemId: Number(itemId), qty: Number(qty), offered: offered.has(`dep:${itemId}`) })),
    // Every stored line the server issued a key for, with the operator's decision: a key absent from
    // the list would mean « leave as stored », which could never un-offer a line.
    storedLines: storedKeys.map((key) => ({ key, offered: offered.has(key) })),
    extinguisherSealOkAtDeparture: extinguisherCheck ? (extinguisherOk ? 1 : 0) : undefined,
    extinguisherCharges: extinguisherCheck && !extinguisherOk
      ? extinguisherKeys.map((repairKey) => ({
        repairKey, qty: Number(extinguisherQty[repairKey]) || 0, offered: offered.has(`ext:${repairKey}`),
      }))
      : [],
    // The authoritative offered set of the recalled arrival lines; the server ignores it while the
    // arrival is not recalled (rule 11), so the dialog sends it whenever it has one.
    offeredArrivalExtras: [...offered]
      .map((key) => RECALLED_REF.exec(String(key)))
      .filter(Boolean)
      .map(([, kind, id]) => ({ kind, id: Number(id) })),
  };
}
