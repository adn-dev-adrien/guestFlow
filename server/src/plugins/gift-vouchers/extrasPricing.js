/**
 * The price of each step of what can be added to a voucher (specs/gift-vouchers/gift-voucher-campaigns.md rule 64) and of the extra time of a session. The add-on tables are the core's
 * `addOnPricing` (shared with the site's session block, specs/site/site-outside-resource-booking.md rule 37); this file adds the extra time. The page reads these tables and adds nothing.
 *
 *   priced([{ articleRef, label, maxQty }]) → the same entries with `addOn`'s fields, those the engine cannot price at all left out
 *   addOn(articleRef, maxQty)  → { unitLabel, linear, prices: [{ qty, cents }] }   for 1 … maxQty; a quantity the engine cannot price drops it and the ones after
 *   extraTime({ resourceId, band, rankOffsetMinutes, stepMinutes, maxMinutes, period? }) → [{ minutes, cents }]   the extra time's ranks continue after `rankOffsetMinutes`
 *
 * One engine quote per step, stopping at the first step that cannot be priced (`keepUnpriced` lists it with `cents: null` and goes on).
 */

const sdk = require('../sdk');

function createExtrasPricing({ engine, catalogue }) {
  const quoted = (lines) => {
    const answer = engine.quote({ lines });
    if (answer.status !== 200 || answer.refusals.length || answer.document.lines.length !== lines.length) return null;
    return answer.document.lines;
  };

  const { addOn, priced } = sdk.coreModule('addOnPricing').createAddOnPricing({ engine, priceTypeOf: (articleRef) => (catalogue.element(articleRef) || {}).priceType });

  /** `keepUnpriced`: a step the engine cannot price is listed with `cents: null` (and the steps after it are still tried) instead of ending the table. */
  function extraTime({
    resourceId, band, rankOffsetMinutes, stepMinutes, maxMinutes, keepUnpriced = false, period,
  }) {
    const prices = [];
    for (let minutes = stepMinutes; minutes <= maxMinutes; minutes += stepMinutes) {
      const rows = quoted([{ articleRef: `resource:${resourceId}`, session: {
          band, minutes, rankOffsetMinutes, ...(period ? { period } : {}),
        },
      }]);
      if (!rows && !keepUnpriced) break;
      prices.push({ minutes, cents: rows ? rows[0].totalCents : null });
    }
    return prices;
  }

  return { addOn, priced, extraTime };
}

module.exports = { createExtrasPricing };
