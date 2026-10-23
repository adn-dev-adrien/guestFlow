/**
 * arrivalDraft — the arrival SAS decisions as the server reads them (specs/sas-arrival-total-server-side.md
 * rule 4): ONE object, sent to the preview while the operator works and to the commit at the end.
 * Intent only — no amount, no total, no price (rules 5-7, 15): the server prices everything.
 *
 * Input (all from the dialog's local state):
 *   activeKeys        — the pages of this run (a tri-state field is `undefined` when its page is absent)
 *   missingBed        — { [linenItemId]: qty } chosen on « Éléments de linge manquants »
 *   keptLines         — [{ customOptionId }] lines a previous run stored whose item no longer exists
 *   cleaningAdded, bathLinenAdded — the two upsell answers
 *   soldSelections    — what the sale steps sell: [{ offer, occurrences, persons, units }]
 *   offered           — Set of offer keys (« Offrir »)
 *   pluginSteps       — the commit payload of the plugin steps that ran
 */

const EXISTING_REF = /^(option|resource|custom|extraGuests):(\d+)$/;

export default function buildArrivalDraft({
  activeKeys = [], missingBed = {}, keptLines = [], cleaningAdded, bathLinenAdded,
  soldSelections = [], offered = new Set(), pluginSteps = {},
}) {
  const ran = (key) => activeKeys.includes(key);
  return {
    linenItems: Object.entries(missingBed)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([itemId, qty]) => ({ itemId: Number(itemId), qty: Number(qty), offered: offered.has(`bed:${itemId}`) })),
    keptLines: keptLines.map((l) => ({
      customOptionId: Number(l.customOptionId), offered: offered.has(`kept:${Number(l.customOptionId)}`),
    })),
    cleaningAdded: ran('cleaning') ? Boolean(cleaningAdded) : undefined,
    bathLinenAdded: ran('bathLinen') ? Boolean(bathLinenAdded) : undefined,
    cleaningOffered: offered.has('cleaning'),
    bathLinenOffered: offered.has('bathLinen'),
    // The array is the WHOLE selection; `undefined` = neither sale step ran.
    soldOptions: (ran('breakfastSale') || ran('cateringAsk'))
      ? soldSelections.map((s) => (s.occurrences
        ? { optionId: s.offer.optionId, occurrences: s.occurrences, persons: s.persons }
        : { optionId: s.offer.optionId, units: s.units }))
      : undefined,
    // The authoritative offered set of the pre-existing complement lines (absent from it = billed).
    offeredExtras: [...offered]
      .map((key) => EXISTING_REF.exec(String(key)))
      .filter(Boolean)
      .map(([, kind, id]) => ({ kind, id: Number(id) })),
    pluginSteps,
  };
}
