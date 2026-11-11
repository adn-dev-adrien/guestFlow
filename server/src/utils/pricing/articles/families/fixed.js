/**
 * Article family `fixed` — one price per unit sold, whatever the stay (specs/pricing-components.md §3 rule 47).
 *
 * Contract: `{ id, configSchema, validate(config, request, ctx), price(config, request, ctx), describe(config, line) }`.
 * `price` returns `{ quantity, unitPrice, billedUnits, typed, components, allowanceUsed, amounts }` before the head
 * merges the sold snapshot, the free units and « offert »; `amounts` are tagged amounts, never VAT. Price types served:
 * per_stay, free.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('../../money');
const { getTypeMultiplier, resolveNonCardUnits } = require('../units');
const kit = require('../familyKit');

const PRICE_TYPES = ["per_stay", "free"];
const configSchema = kit.configSchemaFor(PRICE_TYPES);

const validate = (config, request, ctx) => kit.refusalsOf(request, ctx, {});

// `request.untyped` — the line has no typed count (a resource, an insurance): units follow the stay.
function price(config, request, ctx) {
  const typed = request.untyped ? null : resolveNonCardUnits({
    priceType: config.priceType,
    quantity: request.quantity,
    persons: ctx.persons,
    nights: ctx.nights,
    cardPersons: request.cardPersons,
    cardNights: request.cardNights,
    maxGuests: ctx.maxGuests,
  });
  const billedUnits = typed ? typed.billedUnits : roundMoney(request.quantity * getTypeMultiplier(config.priceType, ctx.persons, ctx.nights));
  return kit.priced(config, request, {
    quantity: request.quantity, unitPrice: Number(config.price || 0), billedUnits, typed,
  });
}

const family = {
  id: 'fixed', priceTypes: PRICE_TYPES, configSchema, validate, price, describe: kit.describeLine,
};

module.exports = { family, PRICE_TYPES };
