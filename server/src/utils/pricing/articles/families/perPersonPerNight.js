/**
 * Article family `perPersonPerNight` — one price per person and per night (specs/pricing-components.md §3 rule 47).
 *
 * Contract: `{ id, configSchema, validate(config, request, ctx), price(config, request, ctx), describe(config, line) }`.
 * `price` returns `{ quantity, unitPrice, billedUnits, typed, components, allowanceUsed, amounts }` before the head
 * merges the sold snapshot, the free units and « offert »; `amounts` are tagged amounts, never VAT. Price types served:
 * per_person_per_night.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('../../money');
const { resolveCoveredPersons } = require('../units');
const kit = require('../familyKit');

const PRICE_TYPES = ["per_person_per_night"];
const configSchema = kit.configSchemaFor(PRICE_TYPES);

// One unit per person and per night.
const multiplier = (persons, nights) => persons * nights;

// The operator may type a count of people (« 3 personnes »): it stays that count; the nights follow the stay.
function resolveUnits({
  quantity, persons, nights, cardPersons, maxGuests,
}) {
  const covers = resolveCoveredPersons({ cardPersons, persons, maxGuests });
  return {
    billedUnits: roundMoney(quantity * covers.served * nights),
    cardPersons: covers.stored,
    cardNights: null,
    servedPersons: roundMoney(quantity * covers.served),
  };
}

const validate = (config, request, ctx) => kit.refusalsOf(request, ctx, { needsPersons: true, needsNights: true });

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
  id: 'perPersonPerNight', priceTypes: PRICE_TYPES, multiplier, resolveUnits, configSchema, validate, price, describe: kit.describeLine,
};

module.exports = { family, PRICE_TYPES };
