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

/**
 * The option ids an update must put back: property defaults marked « offered » (the services
 * included in the rate) that the booking ALREADY carries and whose payload dropped them.
 *
 * specs/tourist-tax-included-services-deduction.md rules 4-5 — an included service is not optional:
 * the fiche locks its Switch ON and the server refuses to drop it, so two identical stays always
 * declare the same tourist-tax base. Restricted to what the booking already carries on purpose: an
 * existing reservation must never GAIN an option it did not have
 * (specs/reservation-option-immutability.md rules 3-4). Pure: the caller injects `defaultsModel`
 * (with `listForProperty(propertyId)` → [{ optionId, offered }]) and the two id lists.
 */
function carriedOfferedDefaultsToRestore({ propertyId, carriedOptionIds, submittedOptionIds, defaultsModel }) {
  const defaults = defaultsModel.listForProperty(Number(propertyId));
  if (!defaults || defaults.length === 0) return [];
  const carried = new Set((carriedOptionIds || []).map((id) => Number(id)));
  const submitted = new Set((submittedOptionIds || []).map((id) => Number(id)));
  return defaults
    .filter((d) => d.offered && carried.has(Number(d.optionId)) && !submitted.has(Number(d.optionId)))
    .map((d) => Number(d.optionId));
}

module.exports = { mergePropertyDefaultsIntoPayload, carriedOfferedDefaultsToRestore };
