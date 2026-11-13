/**
 * Article family `perNight` — one price per night counted (specs/pricing-components.md §3 rule 47).
 *
 * Contract: `{ id, configSchema, validate(config, request, ctx), price(config, request, ctx), describe(config, line) }`.
 * `price` returns `{ quantity, unitPrice, billedUnits, typed, components, allowanceUsed, amounts }` before the head
 * merges the sold snapshot, the free units and « offert »; `amounts` are tagged amounts, never VAT. Price types served:
 * per_night.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('../../money');
const kit = require('../familyKit');

const PRICE_TYPES = ["per_night"];
const configSchema = kit.configSchemaFor(PRICE_TYPES);

// One unit per night of the stay.
const multiplier = (persons, nights) => nights;

// The operator may type a count of nights (« 2 nuits »): it stays that count (specs/non-card-option-served-persons.md rules 2-5, 19).
function resolveUnits({ quantity, nights, cardNights }) {
  const wanted = Number(cardNights) > 0 ? Math.floor(Number(cardNights)) : null;
  const counted = wanted != null ? wanted : nights;
  return {
    billedUnits: roundMoney(quantity * counted),
    cardPersons: null,
    cardNights: counted === nights ? null : counted,
    servedNights: roundMoney(quantity * counted),
  };
}

const validate = (config, request, ctx) => kit.refusalsOf(request, ctx, { needsNights: true });

// `request.untyped` — the line has no typed count (a resource, an insurance): units follow the stay.
function price(config, request, ctx) {
  const typed = request.untyped ? null : resolveUnits({
    quantity: request.quantity,
    persons: ctx.persons,
    nights: ctx.nights,
    cardPersons: request.cardPersons,
    cardNights: request.cardNights,
    maxGuests: ctx.maxGuests,
  });
  const billedUnits = typed ? typed.billedUnits : roundMoney(request.quantity * multiplier(ctx.persons, ctx.nights));
  return kit.priced(config, request, {
    quantity: request.quantity, unitPrice: Number(config.price || 0), billedUnits, typed,
  });
}

const family = {
  id: 'perNight', priceTypes: PRICE_TYPES, multiplier, resolveUnits, configSchema, validate, price, describe: kit.describeLine,
};

module.exports = { family, PRICE_TYPES };
