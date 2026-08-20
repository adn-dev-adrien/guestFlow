/**
 * Booking → form hydration (specs/devis-extras-parity-and-price-lock.md §4.2).
 *
 * A devis and a reservation are the same row with the same children, and `ReservationPage` is the same
 * form for both — but each load path used to map the API payload into form state on its own. The devis
 * branch mapped a strict subset, so re-opening a quote lost the planning-card occurrences, the hourly
 * sessions, the Complément routing and the custom-option ids: the very things the save then dropped.
 *
 * These pure mappers are that shared translation. No fetching, no business rule — the amounts, units and
 * routing are all decided server-side; this only reshapes them for the inputs.
 */

/**
 * Catalogue option lines → `form.selectedOptions`.
 *
 * @param {object[]} options        the booking's `options` array (custom lines included, filtered here)
 * @param {object}   stay           { startDate, endDate, checkInTime, checkOutTime }
 * @param {object[]} catalogue      the property's option catalogue — carries each option's card config
 * @param {function} buildCardGrid  `buildCardGridFromStored`, injected so this module stays dependency-free
 */
export function hydrateSelectedOptions(options, stay, catalogue, buildCardGrid) {
  return (options || []).filter((o) => !o.isCustom).map((o) => {
    // Option-driven planning cards (specs/option-planning-card.md §3.2): rebuild the working occurrence
    // grid from the stored {date,time}[] so the checklist restores the exact saved selection. The
    // option's catalog config (mode + slots) drives the grid.
    const cat = (catalogue || []).find((c) => Number(c.id) === Number(o.optionId));
    const cardOccurrences = (cat && cat.showsPlanningCard && typeof buildCardGrid === 'function')
      ? buildCardGrid(cat, stay.startDate, stay.endDate, o.cardOccurrences, stay.checkInTime, stay.checkOutTime)
      : undefined;
    return {
      optionId: o.optionId,
      quantity: o.quantity,
      totalPrice: o.totalPrice,
      originalTotalPrice: o.originalTotalPrice,
      offered: Boolean(o.offered),
      inComplement: Number(o.inComplement || 0) === 1,
      acompteContribTtc: o.acompteContribTtc != null ? Number(o.acompteContribTtc) : null,
      soldeContribTtc: o.soldeContribTtc != null ? Number(o.soldeContribTtc) : null,
      ...(cardOccurrences ? { cardOccurrences } : {}),
      // specs/card-option-served-persons.md §3.2 — the served count is the operator's decision, so it
      // must come back on the form line: without it the next save re-bills the whole party.
      ...(o.cardPersons != null ? { cardPersons: Number(o.cardPersons) } : {}),
    };
  });
}

/** Custom (free-text) lines → `form.customOptions`. */
export function hydrateCustomOptions(options) {
  return (options || []).filter((o) => o.isCustom).map((o, index) => ({
    customKey: String(o.customOptionId || `custom_${index + 1}`),
    customOptionId: o.customOptionId != null ? Number(o.customOptionId) : undefined,
    description: o.title || o.description || '',
    amount: Number(o.originalTotalPrice ?? o.totalPrice ?? 0),
    offered: Boolean(o.offered),
    inComplement: Number(o.inComplement || 0) === 1,
    acompteContribTtc: o.acompteContribTtc != null ? Number(o.acompteContribTtc) : null,
    soldeContribTtc: o.soldeContribTtc != null ? Number(o.soldeContribTtc) : null,
  }));
}

/** Resource lines → `form.selectedResources`, hourly sessions included. */
export function hydrateSelectedResources(resources) {
  return (resources || []).map((r) => ({
    resourceId: r.resourceId,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    billedUnits: r.billedUnits,
    priceType: r.priceType,
    totalPrice: r.totalPrice,
    originalTotalPrice: Number(r.originalTotalPrice ?? r.totalPrice ?? 0),
    offered: Boolean(r.offered),
    inComplement: Number(r.inComplement || 0) === 1,
    acompteContribTtc: r.acompteContribTtc != null ? Number(r.acompteContribTtc) : null,
    soldeContribTtc: r.soldeContribTtc != null ? Number(r.soldeContribTtc) : null,
    // Hourly-scheduled resources (specs/resource-hourly-scheduling.md) — the session editor reads these
    // back; a devis used to drop them, so its « Bain nordique » came back empty and unbilled.
    sessions: Array.isArray(r.sessions) ? r.sessions : parseSessions(r.sessions),
  }));
}

/** The offered catalogue options, as the `Set` the form keeps beside `selectedOptions`. */
export function hydrateOfferedOptionIds(options) {
  return new Set((options || []).filter((o) => !o.isCustom && Boolean(o.offered)).map((o) => o.optionId));
}

/**
 * The unit prices a saved booking was sold at, keyed by line id — what the fiche sends back as
 * `lockedOptionUnits` / `lockedResourceUnits` so a re-save can't silently re-price it.
 */
export function frozenUnitPrices(lines, idKey) {
  return Object.fromEntries((lines || []).map((line) => [
    line[idKey],
    line.unitPrice !== undefined
      ? Number(line.unitPrice || 0)
      : (Math.max(0, Number(line.totalPrice || 0)) / Math.max(1, Number(line.quantity || 1))),
  ]));
}

// `sessions` rides the API as a JSON string on payloads that don't parse it server-side.
function parseSessions(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
