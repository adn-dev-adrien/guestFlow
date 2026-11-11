/**
 * The payload clean-up the option editor used to do in the browser (specs/options-resources-ux.md
 * rule 15). A per-property price, default or bath-mat quantity only means something for a property
 * the option is proposed on, and a free or progressive option has no per-property price. Pure.
 *
 * A key the payload does not carry stays absent: « absent » means « leave the stored value alone », except the per-logement
 * prices of a type that has none (rule 35).
 */

const NO_PROPERTY_PRICE = ['free', 'per_participant_progressive'];

const onlyScoped = (map, scope) => Object.fromEntries(
  Object.entries(map || {}).filter(([pid]) => scope.has(Number(pid))),
);

function scopePayload(payload) {
  if (!payload || !Array.isArray(payload.propertyIds)) return payload;
  const scope = new Set(payload.propertyIds.map(Number));
  const out = { ...payload };
  // specs/options-resources-ux.md rule 35 (audit R26-DB-1) — a type with no per-logement price clears them, sent or not: the
  // engine would otherwise keep billing the stored ones.
  if (NO_PROPERTY_PRICE.includes(payload.priceType)) out.propertyPrices = {};
  else if (payload.propertyPrices !== undefined) out.propertyPrices = onlyScoped(payload.propertyPrices, scope);
  if (payload.propertyDefaults !== undefined) out.propertyDefaults = onlyScoped(payload.propertyDefaults, scope);
  if (payload.propertyBathMats !== undefined) out.propertyBathMats = onlyScoped(payload.propertyBathMats, scope);
  return out;
}

/**
 * specs/options-resources-ux.md rule 33 — the scope of a save whose price type or logements are not sent is the stored
 * one: what the model keeps is what the payload is scoped and judged against.
 */
function withStoredScope(payload, stored) {
  if (!payload || !stored) return payload;
  return {
    ...payload,
    priceType: payload.priceType === undefined ? stored.priceType : payload.priceType,
    propertyIds: payload.propertyIds === undefined ? stored.propertyIds : payload.propertyIds,
  };
}

module.exports = { scopePayload, withStoredScope, NO_PROPERTY_PRICE };
