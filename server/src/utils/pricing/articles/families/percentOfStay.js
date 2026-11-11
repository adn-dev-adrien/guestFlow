/**
 * Article family `percentOfStay` — a percentage of the accommodation actually charged: the cancellation insurance
 * (specs/pricing-components.md §3 rule 47; specs/cancellation-insurance.md §3.1 rules 2-5).
 *
 * Contract: `{ id, configSchema, validate, price, describe }`. `price` returns the unit price IS the computed amount
 * (`ctx.cancellationInsuranceBase` is the assiette resolved by the engine), the quantity is forced to 1 by the head
 * (insuring the same stay twice is meaningless). Tagged amounts, never VAT. Price type served: percent_of_stay.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('../../money');
const { getTypeMultiplier } = require('../units');
const kit = require('../familyKit');

/**
 * Amount of a `percent_of_stay` option (specs/cancellation-insurance.md §3.1 rules 2-4).
 *
 * `percent` is what `options.price` holds for that price type (4 = 4 %), clamped to 0-100 so a
 * corrupt row can never bill more than the stay itself. `base` is the assiette resolved by the
 * engine (`cancellationInsuranceBase`) — the accommodation only.
 *
 * Single source of truth: the billed line AND the public preview shown beside the Oui/Non choice
 * on the website both go through this function, so they cannot diverge.
 */
function computePercentOfStayAmount(percent, base) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const amount = Math.max(0, Number(base) || 0);
  if (pct <= 0 || amount <= 0) return 0;
  return roundMoney((amount * pct) / 100);
}

const PRICE_TYPES = ['percent_of_stay'];
const configSchema = kit.configSchemaFor(PRICE_TYPES).map((entry) => (entry.key === 'price'
  ? { ...entry, validate: (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? null : 'Un pourcentage de 0 à 100 est attendu.') }
  : entry));

const validate = (config, request, ctx) => kit.refusalsOf(request, ctx);

function price(config, request, ctx) {
  const unitPrice = computePercentOfStayAmount(config.price, ctx.cancellationInsuranceBase);
  const billedUnits = roundMoney(request.quantity * getTypeMultiplier(config.priceType, ctx.persons, ctx.nights));
  return kit.priced(config, request, { quantity: request.quantity, unitPrice, billedUnits });
}

function describe(config, line) {
  const base = kit.describeLine(config, line);
  return { label: base.label, detail: `${String(config.price).replace('.', ',')} % du séjour` };
}

const family = {
  id: 'percentOfStay', priceTypes: PRICE_TYPES, configSchema, validate, price, describe,
};

module.exports = { family, PRICE_TYPES, computePercentOfStayAmount };
