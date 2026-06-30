/**
 * Merge a property's DEFAULT options into a pricing payload's `selectedOptions`, propagating the
 * `offered` flag (offered default → free, i.e. added to `offeredOptionIds`; non-offered default →
 * a normal paid line). Idempotent: a default already present in the payload is left untouched.
 *
 * Single source of truth so the public live quote, the booking-request devis and the admin devis all
 * apply property defaults IDENTICALLY (specs/public-api.md, devis §3.3 rules 11–13). Pure: the caller
 * injects `defaultsModel` (with `listForProperty(propertyId)` → [{ optionId, offered }]).
 */
function mergePropertyDefaultsIntoPayload(payload, propertyId, defaultsModel) {
  const defaults = defaultsModel.listForProperty(propertyId);
  if (!defaults || defaults.length === 0) return payload;
  const existing = new Set((payload.selectedOptions || []).map((o) => Number(o.optionId)));
  const toAdd = defaults
    .filter((d) => !existing.has(Number(d.optionId)))
    .map((d) => ({ optionId: Number(d.optionId), quantity: 1 }));
  if (toAdd.length === 0) return payload;
  // A default with offered=true means the line is included in the price (no extra charge).
  const existingOfferedIds = new Set((payload.offeredOptionIds || []).map((id) => Number(id)));
  const newOfferedIds = defaults
    .filter((d) => d.offered && !existingOfferedIds.has(Number(d.optionId)))
    .map((d) => Number(d.optionId));
  return {
    ...payload,
    selectedOptions: [...(payload.selectedOptions || []), ...toAdd],
    offeredOptionIds: [...(payload.offeredOptionIds || []), ...newOfferedIds],
  };
}

module.exports = { mergePropertyDefaultsIntoPayload };
