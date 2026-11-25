/**
 * The price of each step of what can be added to a voucher (specs/gift-voucher-campaigns.md rule 63), asked of the pricing engine for the outside customer — the same
 * way a price request prices the line, so a figure read here is the figure the request answers. The page reads these tables and adds nothing.
 *
 *   priced([{ articleRef, label, maxQty }]) → the same entries with `addOn`'s fields, those the engine cannot price at all left out
 *   addOn(articleRef, maxQty)  → { unitLabel, linear, prices: [{ qty, cents }] }   for 1 … maxQty; a quantity the engine cannot price drops it and the ones after
 *   extraTime({ resourceId, band, rankOffsetMinutes, stepMinutes, maxMinutes }) → [{ minutes, cents }]   the extra time's ranks continue after `rankOffsetMinutes`
 *
 * One engine quote per step, stopping at the first step that cannot be priced (`keepUnpriced` lists it with `cents: null` and goes on).
 */

// Priced per person: « par personne ». Every other family an add-on is sold in outside a stay is a count: « l'unité ».
const PER_PERSON_TYPES = Object.freeze(['per_person', 'per_participant_progressive']);

function createExtrasPricing({ engine, catalogue }) {
  const quoted = (lines) => {
    const answer = engine.quote({ lines });
    if (answer.status !== 200 || answer.refusals.length || answer.document.lines.length !== lines.length) return null;
    return answer.document.lines;
  };

  function addOn(articleRef, maxQty) {
    const element = catalogue.element(articleRef) || {};
    const prices = [];
    for (let qty = 1; qty <= maxQty; qty += 1) {
      const rows = quoted([{ articleRef, quantity: qty }]);
      if (!rows) break;
      prices.push({ qty, cents: rows[0].totalCents });
    }
    return {
      unitLabel: PER_PERSON_TYPES.includes(element.priceType) ? 'par personne' : 'l’unité',
      linear: element.priceType !== 'per_participant_progressive',
      prices,
    };
  }

  /** Each add-on of `list` with its price table; one the engine cannot sell outside a stay at all (no price for a single unit) is left out, as the price request would refuse it. */
  const priced = (list) => list.map((entry) => ({ ...entry, ...addOn(entry.articleRef, entry.maxQty) })).filter((entry) => entry.prices.length > 0);

  /** `keepUnpriced`: a step the engine cannot price is listed with `cents: null` (and the steps after it are still tried) instead of ending the table. */
  function extraTime({
    resourceId, band, rankOffsetMinutes, stepMinutes, maxMinutes, keepUnpriced = false,
  }) {
    const prices = [];
    for (let minutes = stepMinutes; minutes <= maxMinutes; minutes += stepMinutes) {
      const rows = quoted([{ articleRef: `resource:${resourceId}`, session: { band, minutes, rankOffsetMinutes } }]);
      if (!rows && !keepUnpriced) break;
      prices.push({ minutes, cents: rows ? rows[0].totalCents : null });
    }
    return prices;
  }

  return { addOn, priced, extraTime };
}

module.exports = { createExtrasPricing };
