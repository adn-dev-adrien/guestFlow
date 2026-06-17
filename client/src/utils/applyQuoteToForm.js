/**
 * Pure data-shaping helper used by ReservationPage after every live pricing recompute.
 *
 * Merges the server-computed `quote` back into the form state. Critically, it **preserves the
 * user's local `inComplement` toggles + the per-line captured contribs** across recomputes —
 * the engine's value is only used as a fallback when the line wasn't in the previous form state
 * (initial load case). Without this preservation, every keystroke that triggered a recompute
 * would erase a freshly-toggled `Compl.` checkbox, making the feature unusable
 * (spec force-item-to-complement.md §3.1).
 *
 * Returns a NEW form object — never mutates `prev`. Designed to be passed straight into
 * `setForm(prev => applyQuoteToForm(prev, quote))`.
 *
 * @param {object} prev                    previous form state
 * @param {object} quote                   server pricing quote
 * @param {object} [opts]
 * @param {boolean} [opts.preserveBlankPrice=false]  reserved for the iCal-imported-blank case
 * @returns {object} the next form state
 */
function applyQuoteToForm(prev, quote, opts = {}) {
  const { preserveBlankPrice = false } = opts;
  void preserveBlankPrice; // kept in the signature for callers that pass it through
  const resourceLinesById = new Map(
    (quote.resourceLines || []).map((line) => [Number(line.resourceId), line])
  );

  // Preserve user-manually-set customPrice: if prev.customPrice is not empty, keep it.
  // totalPrice comes from the quote (server-calculated).
  const shouldPreserveCustomPrice = prev.customPrice !== '';

  return {
    ...prev,
    totalPrice: quote.totalPrice == null ? '' : Number(quote.totalPrice || 0),
    touristTaxRate: Number(quote.touristTaxRate || 0),
    touristTaxTotal: Number(quote.touristTaxTotal || 0),
    finalPrice: shouldPreserveCustomPrice && prev.customPrice !== ''
      ? Number(prev.customPrice)
      : (quote.finalPrice == null ? '' : Number(quote.finalPrice || 0)),
    depositAmount: Number(quote.depositAmount || 0),
    depositDueDate: quote.depositDueDate || '',
    balanceAmount: Number(quote.balanceAmount || 0),
    balanceDueDate: quote.balanceDueDate || '',
    // CRITICAL: preserve `inComplement` + per-line contribs from the quote, otherwise the next
    // recompute cycle erases the flag the user just toggled (regression pinned by
    // `applyQuoteToForm.unit.test.js`). `prev.selectedOptions[i].inComplement` is the source
    // of truth — the user's local click is what matters; the engine value is only consulted
    // when the line wasn't in `prev` (initial load).
    selectedOptions: (quote.optionLines || []).filter((line) => !line.isCustom).map((line) => {
      const prevLine = (prev.selectedOptions || []).find(
        (s) => Number(s.optionId) === Number(line.optionId)
      );
      return {
        optionId: Number(line.optionId),
        quantity: Number(line.quantity || 0),
        totalPrice: Number(line.totalPrice || 0),
        originalTotalPrice: Number(line.originalTotalPrice ?? line.totalPrice ?? 0),
        offered: Boolean(line.offered),
        inComplement: prevLine && prevLine.inComplement !== undefined
          ? Boolean(prevLine.inComplement)
          : Boolean(line.inComplement),
        acompteContribTtc: line.acompteContribTtc != null ? Number(line.acompteContribTtc) : null,
        soldeContribTtc: line.soldeContribTtc != null ? Number(line.soldeContribTtc) : null,
        ...(line.autoExtraHours !== undefined ? { autoExtraHours: Number(line.autoExtraHours) } : {}),
        ...(line.autoFullNightApplied !== undefined ? { autoFullNightApplied: Boolean(line.autoFullNightApplied) } : {}),
        // Option-driven planning cards (specs/option-planning-card.md §3.2): the per-reservation
        // occurrence grid is the user's source of truth (like inComplement) — preserve it across
        // recomputes. Dropping it would make the next recompute send no occurrences → the server
        // returns no line → the option vanishes (the bug this fixes). The richer working grid
        // (checked/slot) wins over the server's bare {date,time} line echo.
        ...(prevLine && Array.isArray(prevLine.cardOccurrences)
          ? { cardOccurrences: prevLine.cardOccurrences }
          : (Array.isArray(line.cardOccurrences) ? { cardOccurrences: line.cardOccurrences } : {})),
      };
    }),
    customOptions: (quote.optionLines || []).filter((line) => line.isCustom).map((line, index) => {
      const customKey = String(line.customKey || `custom_${index + 1}`);
      const prevLine = (prev.customOptions || []).find((c) => String(c.customKey) === customKey);
      return {
        customKey,
        customOptionId: prevLine?.customOptionId,
        description: String(line.title || line.description || '').trim(),
        amount: Number(line.originalTotalPrice ?? line.totalPrice ?? 0),
        offered: Boolean(line.offered),
        inComplement: prevLine && prevLine.inComplement !== undefined
          ? Boolean(prevLine.inComplement)
          : Boolean(line.inComplement),
        acompteContribTtc: line.acompteContribTtc != null ? Number(line.acompteContribTtc) : null,
        soldeContribTtc: line.soldeContribTtc != null ? Number(line.soldeContribTtc) : null,
      };
    }),
    selectedResources: (prev.selectedResources || []).map((item) => {
      const line = resourceLinesById.get(Number(item.resourceId));
      return {
        ...item,
        unitPrice: Number(line?.unitPrice ?? item.unitPrice ?? 0),
        totalPrice: Number(line?.totalPrice || 0),
        offered: Boolean(line?.offered ?? item.offered),
        // `item.inComplement` is the source of truth (user's local toggle); fall back to the
        // engine value only when the resource wasn't in the previous form state.
        inComplement: item.inComplement !== undefined ? Boolean(item.inComplement) : Boolean(line?.inComplement),
        acompteContribTtc: line?.acompteContribTtc != null ? Number(line.acompteContribTtc) : null,
        soldeContribTtc: line?.soldeContribTtc != null ? Number(line.soldeContribTtc) : null,
      };
    }),
  };
}

export { applyQuoteToForm };
