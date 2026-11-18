/**
 * The fiche's pricing request bodies (specs/pricing-components.md rule 94 reading, loop t16 S16-2).
 *
 * `ReservationPage` asks the server for a quote in several places — the live preview, the quote taken at « Enregistrer » (whose
 * `resourceLines` the save stores), « Actualiser les tarifs », and the ledger's re-quote (built when sent, like the others). Each used to
 * build its own body, and a field added to one was missing from the others: the admin unlock reached the live preview only, so the
 * save stored the locked fiche's routing the preview had just lifted. One builder now, so they price the same request.
 *
 * Pure: no React, no fetching. The amounts, units and routing are all decided server-side; this only shapes the form into the wire
 * format (the line payloads below are also what the save itself posts).
 *
 *   selectedOptionsPayload(form, catalogue)  the catalogue lines the form edits (engine-derived options left out) + its later lines
 *   customOptionsPayload(customOptions, savedCustomKeys)  the free lines, trimmed; a line with no text or no amount is not sent; a line
 *                                            typed and not saved yet (`customKey` not in `savedCustomKeys`) is `newLine`
 *   selectedResourcesPayload(form)           the resource lines (with hourly sessions) + the later lines
 *   ficheQuoteBody(input, overrides)         the quote request; `input` = { form, propertyId, offeredOptionIds, lockedOptionUnits,
 *                                            lockedResourceUnits, forceCurrentPricing, refreshTouristTax, reservationId, devisId,
 *                                            newDevisQuoteMarker, unlockPast, catalogue, savedCustomKeys }
 */
import { toWireOccurrences } from './cardOccurrences.js';

const routing = (value) => (value == null ? null : (value ? 1 : 0));

export function selectedOptionsPayload(form, catalogue) {
  return (form.selectedOptions || [])
    // Skip only engine-derived options (autoEnabled = 1), not the typed-default linen options (autoOptionType set, autoEnabled = 0).
    .filter((item) => Number((catalogue || []).find((o) => o.id === Number(item.optionId))?.autoEnabled || 0) !== 1)
    .map((item) => {
      const line = { optionId: item.optionId, quantity: item.quantity, inComplement: routing(item.inComplement) };
      // Option-driven planning cards (specs/option-planning-card.md §3.4): the CHECKED occurrences ({date,time}); the server derives
      // billedUnits from them (authoritative).
      if (Array.isArray(item.cardOccurrences)) line.cardOccurrences = toWireOccurrences(item.cardOccurrences);
      // Served persons of that card option (specs/card-option-served-persons.md §3.2 rule 9): an intent, never a price.
      if (item.cardPersons != null) line.cardPersons = Number(item.cardPersons);
      if (item.cardNights != null) line.cardNights = Number(item.cardNights);
      if (item.typedAtParty != null) line.typedAtParty = item.typedAtParty;
      if (item.typedAtNights != null) line.typedAtNights = item.typedAtNights;
      return line;
    })
    .concat(form.laterOptions || []);
}

export function customOptionsPayload(customOptions, savedCustomKeys = new Set()) {
  return (customOptions || [])
    .map((line, index) => ({
      customKey: String(line.customKey || `custom_${index + 1}`),
      customOptionId: line.customOptionId != null ? Number(line.customOptionId) : undefined,
      // A line typed on the fiche and not saved yet names no stored row: it is a new line, whatever its text (rule 94 reading, loop t16
      // S16-3 b) — never the row of a line removed in the same save under the same label. Once a save stored it (`savedCustomKeys`, the fiche
      // kept open without re-reading its ids — VS16-1) it is not new any more: no flag, the server finds its row by its text (rule 19).
      ...(line.customOptionId == null && !savedCustomKeys.has(String(line.customKey || `custom_${index + 1}`)) ? { newLine: true } : {}),
      description: String(line.description || '').trim(),
      amount: Number(line.amount || 0),
      offered: Boolean(line.offered),
      inComplement: routing(line.inComplement),
    }))
    .filter((line) => line.description && Number(line.amount || 0) > 0);
}

export function selectedResourcesPayload(form) {
  return (form.selectedResources || [])
    .map((item) => ({
      resourceId: item.resourceId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      offered: Boolean(item.offered),
      inComplement: routing(item.inComplement),
      // Hourly-scheduled sessions (specs/resource-hourly-scheduling.md) — drive the server pricer.
      sessions: Array.isArray(item.sessions) ? item.sessions : [],
    }))
    .filter((item) => Number(item.quantity || 0) > 0 || (Array.isArray(item.sessions) && item.sessions.length > 0))
    .concat(form.laterResources || []);
}

export function ficheQuoteBody(input, overrides = {}) {
  const {
    form, propertyId, catalogue, offeredOptionIds, lockedOptionUnits, lockedResourceUnits, forceCurrentPricing, refreshTouristTax,
    reservationId, devisId, newDevisQuoteMarker, unlockPast, savedCustomKeys,
  } = input;
  return {
    propertyId: Number(propertyId),
    startDate: form.startDate,
    endDate: form.endDate,
    checkInTime: form.checkInTime,
    checkOutTime: form.checkOutTime,
    adults: form.adults,
    children: form.children,
    teens: form.teens,
    babies: Number(form.babies || 0),
    babyBeds: Number(form.babyBeds || 0),
    extraGuestSurchargeOffered: form.extraGuestSurchargeOffered,
    discountPercent: form.discountPercent,
    discountTarget: form.discountTarget,
    customPrice: form.customPrice,
    platformCommissionAmount: form.platformCommissionAmount, // specs/platform-commission-line.md (solde commission)
    acompteCommissionAmount: form.acompteCommissionAmount, // specs/platform-per-echeance-commission.md (acompte commission)
    platformGrossAmount: form.platformGrossAmount, // specs/platform-payment-entry.md (pins the total séjour)
    platformTouristTaxAmount: form.platformTouristTaxAmount, // specs/platform-tourist-tax-out-of-the-commission.md (comes back out of the brut)
    depositPaid: form.depositPaid,
    balancePaid: form.balancePaid,
    complementPaid: form.complementPaid,
    depositAmount: form.depositAmount,
    depositAmountOverride: form.depositAmountOverride === '' ? null : Number(form.depositAmountOverride),
    // specs/adjustable-complement-amounts.md §3.2 — the operator's complement rides every quote and every save, so the preview, the
    // fiche total and the stored amount can never disagree.
    complementAmountOverride: form.complementAmountOverride === '' ? null : Number(form.complementAmountOverride),
    balanceAmount: form.balanceAmount,
    depositDisabled: Boolean(form.depositDisabled),
    selectedOptions: selectedOptionsPayload(form, catalogue),
    customOptions: customOptionsPayload(form.customOptions, savedCustomKeys),
    selectedResources: selectedResourcesPayload(form),
    offeredOptionIds: Array.from(offeredOptionIds || []),
    lockedOptionUnits: lockedOptionUnits || {},
    lockedResourceUnits: lockedResourceUnits || {},
    forceCurrentPricing: Boolean(forceCurrentPricing),
    platform: form.platform,
    touristTaxInComplement: form.touristTaxInComplement ? 1 : 0,
    autoOptionsInComplement: form.autoOptionsInComplement || [],
    refreshTouristTax,
    ...(reservationId ? { reservationId } : {}),
    // A saved devis locks its prices while it is still valid — the server replays its stored lines so the quote equals what the save
    // will store (specs/devis-extras-parity-and-price-lock.md §3 rule 13).
    ...(devisId ? { devisId } : {}),
    ...(newDevisQuoteMarker || {}),
    // specs/reservation-payment-ledger.md rule 7 — the ledger follows the transfer typed on the fiche.
    platformPayoutAmount: form.platformPayoutAmount,
    // Rule 94 reading (loop t15 S15-1, t16 S16-2) — an admin-unlocked fiche is quoted as its save prices it: without the locked fiche's
    // routing, on every quote of the fiche.
    ...(unlockPast ? { unlockPast: true } : {}),
    ...overrides,
  };
}
