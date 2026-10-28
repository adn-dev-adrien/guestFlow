/**
 * The payload clean-up the option editor used to do in the browser (specs/options-resources-ux.md
 * rule 15). A per-property price, default or bath-mat quantity only means something for a property
 * the option is proposed on, and a free or progressive option has no per-property price. Pure.
 *
 * A key the payload does not carry stays absent: « absent » means « leave the stored value alone ».
 */

const NO_PROPERTY_PRICE = ['free', 'per_participant_progressive'];

const onlyScoped = (map, scope) => Object.fromEntries(
  Object.entries(map || {}).filter(([pid]) => scope.has(Number(pid))),
);

function scopePayload(payload) {
  if (!payload || !Array.isArray(payload.propertyIds)) return payload;
  const scope = new Set(payload.propertyIds.map(Number));
  const out = { ...payload };
  if (payload.propertyPrices !== undefined) {
    out.propertyPrices = NO_PROPERTY_PRICE.includes(payload.priceType) ? {} : onlyScoped(payload.propertyPrices, scope);
  }
  if (payload.propertyDefaults !== undefined) out.propertyDefaults = onlyScoped(payload.propertyDefaults, scope);
  if (payload.propertyBathMats !== undefined) out.propertyBathMats = onlyScoped(payload.propertyBathMats, scope);
  return out;
}

module.exports = { scopePayload };
