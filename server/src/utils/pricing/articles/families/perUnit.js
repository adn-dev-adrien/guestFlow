/**
 * Article family `perUnit` — n units counted by the operator, whatever the stay: the moments placed on a planning card
 * (a breakfast on 3 mornings, a dinner on 2 evenings) or the portions asked while they are not placed yet
 * (specs/pricing-components.md §3 rule 47; specs/option-planning-card.md §3.4, specs/unscheduled-card-option.md).
 *
 * Contract: `{ id, configSchema, validate, price, describe }`. `price` reads `request.occurrences` (placed moments) or
 * `request.quantity` (portions to place): billed units = moments × the covers of each when the option is per person,
 * else the moments. The head applies the unit price the line was sold at, the free units and « offert ».
 * Tagged amounts, never VAT. Served: the options with a planning card, whatever their price type.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('../../money');
const { resolveServedPersons } = require('../units');
const kit = require('../familyKit');

const configSchema = kit.configSchemaFor(['per_stay', 'per_person']);

const validate = (config, request, ctx) => kit.refusalsOf(request, ctx);

function price(config, request, ctx) {
  const unitPrice = Number(config.price || 0);
  const occurrences = Array.isArray(request.occurrences) ? request.occurrences : [];
  if (occurrences.length > 0) {
    const perPerson = String(config.priceType).includes('per_person');
    // How many covers on each moment (specs/card-option-served-persons.md §3.1 rule 2): the
    // party unless the operator said otherwise, capped by the property's capacity.
    const covers = resolveServedPersons({
      cardPersons: request.cardPersons, persons: ctx.persons, maxGuests: ctx.maxGuests,
    });
    const billedUnits = roundMoney(occurrences.length * (perPerson ? covers.served : 1));
    return {
      ...kit.priced(config, request, { quantity: occurrences.length, unitPrice, billedUnits }),
      cardPersons: perPerson ? covers.stored : null,
    };
  }
  const billedUnits = roundMoney(request.quantity);
  return { ...kit.priced(config, request, { quantity: request.quantity, unitPrice, billedUnits }), cardPersons: null };
}

const family = {
  id: 'perUnit', priceTypes: [], configSchema, validate, price, describe: kit.describeLine,
};

module.exports = { family };
