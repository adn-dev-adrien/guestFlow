/**
 * addOnPricing — the price of each step of an add-on sold outside a stay, asked of the pricing engine for the outside customer the same way a price request prices the
 * line, so a figure read here is the figure the request answers (specs/gift-vouchers/gift-voucher-campaigns.md rule 64, specs/site/site-outside-resource-booking.md rule 37). Shared by every
 * plugin that offers add-ons outside a stay (a campaign's add-ons, the site's session options): the page reads the tables and adds nothing.
 *
 *   createAddOnPricing({ engine, priceTypeOf }) → { addOn, priced }
 *     engine.quote({ lines }) → the standalone sale quote (`status`, `refusals`, `document.lines[].totalCents`)
 *     priceTypeOf(articleRef) → the article's `priceType`, or undefined (default: the catalogue's own row of the reference)
 *   addOn(articleRef, maxQty)  → { unitLabel, linear, prices: [{ qty, cents }] }   for 1 … maxQty; a quantity the engine cannot price ends the table
 *   unitLabelOf(priceType)     → what a unit is counted in: « l’unité », « par personne », « par jour », « par personne / jour » (the catalogue and the settings page show it as given)
 *   priced([{ articleRef, label, maxQty }]) → the same entries with `addOn`'s fields, those the engine cannot price at all left out
 */

// What one unit of each price type is counted in, from the words of `PRICE_TYPE_LABELS`: an add-on sold outside a stay is a count (« l'unité ») or priced per person; the
// per-day types only exist in a stay (a hosted list).
const UNIT_LABELS = Object.freeze({
  per_person: 'par personne',
  per_participant_progressive: 'par personne',
  per_night: 'par jour',
  per_person_per_night: 'par personne / jour',
});
const unitLabelOf = (priceType) => UNIT_LABELS[priceType] || 'l’unité';

function catalogueTypeOf(articleRef) {
  const found = require('../models/standaloneSalesModel').catalogueRow(articleRef);
  return found ? require('./pricing/articles').makeArticle(found.row, { kind: found.kind }).config.priceType : undefined;
}

function createAddOnPricing({ engine, priceTypeOf = catalogueTypeOf }) {
  function addOn(articleRef, maxQty) {
    const prices = [];
    for (let qty = 1; qty <= maxQty; qty += 1) {
      const answer = engine.quote({ lines: [{ articleRef, quantity: qty }] });
      if (answer.status !== 200 || answer.refusals.length || answer.document.lines.length !== 1) break;
      prices.push({ qty, cents: answer.document.lines[0].totalCents });
    }
    const priceType = priceTypeOf(articleRef);
    return {
      unitLabel: unitLabelOf(priceType),
      linear: priceType !== 'per_participant_progressive',
      prices,
    };
  }

  /** Each add-on of `list` with its price table; one the engine cannot sell outside a stay at all (no price for a single unit) is left out, as the price request would refuse it. */
  const priced = (list) => list.map((entry) => ({ ...entry, ...addOn(entry.articleRef, entry.maxQty) })).filter((entry) => entry.prices.length > 0);

  return { addOn, priced };
}

module.exports = { createAddOnPricing, unitLabelOf };
