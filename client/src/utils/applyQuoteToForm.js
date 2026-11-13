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
// Explicit extension: `applyQuoteToForm.test.js` loads this module through CommonJS `require`, and
// that path has no extension resolution.
import { WELCOME_PACK_TAG } from './welcomePackApply.js';

const typedCountFromEcho = (column, line, prevLine) => {
  if (line[column] != null) return { [column]: Number(line[column]) };
  return prevLine && prevLine[column] != null ? { [column]: Number(prevLine[column]) } : {};
};

function applyQuoteToForm(prev, quote, opts = {}) {
  const { preserveBlankPrice = false } = opts;
  void preserveBlankPrice; // kept in the signature for callers that pass it through
  // The form edits an article's first line (rule 85): a later line of a resource keeps its own figures in the quote.
  const resourceLinesById = new Map(
    (quote.resourceLines || []).filter((line) => !line.lineKey).map((line) => [Number(line.resourceId), line])
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
    // A later sale of an article (rule 85, a line that carries its `lineKey`) is not an option of the form: the form carries it as it is.
    selectedOptions: (quote.optionLines || []).filter((line) => !line.isCustom && !line.lineKey).map((line) => {
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
        // specs/non-card-option-served-persons.md rule 30 — the field shows what is billed: a numeric
        // echo wins (the engine may have clamped the count), a `null` echo (« follows the party ») must
        // not wipe a number the operator is in the middle of typing. A stale answer never gets here:
        // the page drops it by request id.
        ...typedCountFromEcho('cardPersons', line, prevLine),
        // Rules 18, 19, 23 — the nights work like the people, the figure a drifted line bills comes from
        // the quote, and the typed-against reference is form-local (the engine knows nothing about it).
        ...typedCountFromEcho('cardNights', line, prevLine),
        ...(line.servedPersons != null ? { servedPersons: Number(line.servedPersons) } : {}),
        ...(line.servedNights != null ? { servedNights: Number(line.servedNights) } : {}),
        ...(prevLine && prevLine.typedAtParty != null ? { typedAtParty: prevLine.typedAtParty } : {}),
        ...(prevLine && prevLine.typedAtNights != null ? { typedAtNights: prevLine.typedAtNights } : {}),
        // specs/welcome-pack-auto-options.md §3.4 — same reason as `cardOccurrences`: the pack tag is
        // form-local (the engine knows nothing about it), so rebuilding the line from the quote would
        // erase it, and with it the form's ability to take back what it added on a platform change.
        ...(prevLine && prevLine[WELCOME_PACK_TAG] ? { [WELCOME_PACK_TAG]: true } : {}),
      };
    }),
    // Custom lines the payload builder filtered out as incomplete (empty description or amount ≤ 0
    // — e.g. a freshly-added line, or one mid-edit) are never sent to the engine, so the quote can't
    // echo them back. They MUST survive the recompute untouched: rebuilding only from the quote
    // erased the operator's in-progress line on every recompute (bug reported 2026-07-20).
    customOptions: (() => {
      const quoteLines = (quote.optionLines || []).filter((line) => line.isCustom).map((line, index) => {
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
      });
      const quoteByKey = new Map(quoteLines.map((l) => [l.customKey, l]));
      const prevKeys = new Set((prev.customOptions || []).map((c) => String(c.customKey)));
      // Keep the form's line order: prev lines first (merged with their quote echo when present,
      // kept verbatim otherwise), then quote-only lines (initial-load case, prev empty).
      return [
        ...(prev.customOptions || []).map((c) => quoteByKey.get(String(c.customKey)) || c),
        ...quoteLines.filter((l) => !prevKeys.has(l.customKey)),
      ];
    })(),
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

const typedCountIn = (line, column) => (line && line[column] != null ? Number(line[column]) : null);
const lineOf = (lines, optionId) => (lines || []).find((l) => Number(l.optionId) === Number(optionId));

/**
 * The clean baseline of the unsaved-changes guard after a quote (specs/non-card-option-served-persons.md
 * rule 30). A numeric echo enters it only when that quote asked for the count the baseline holds: the
 * engine then read the stored line, so a clamped count is no edit. A count the quote asked for and the
 * baseline does not hold was typed meanwhile, and it stays an edit.
 *
 * @param {object} baseline       the form the baseline holds
 * @param {object} quote          server pricing quote
 * @param {Array}  askedLines     `selectedOptions` of the request that quote answers
 * @param {object} [opts]         passed on to `applyQuoteToForm`
 * @returns {object} the next baseline form
 */
function applyQuoteToBaseline(baseline, quote, askedLines, opts = {}) {
  const next = applyQuoteToForm(baseline, quote, opts);
  if (!Array.isArray(askedLines)) return next;
  return {
    ...next,
    selectedOptions: next.selectedOptions.map((line) => {
      const held = lineOf(baseline.selectedOptions, line.optionId);
      const asked = lineOf(askedLines, line.optionId);
      const kept = { ...line };
      ['cardPersons', 'cardNights'].forEach((column) => {
        const value = typedCountIn(held, column);
        if (typedCountIn(asked, column) === value) return;
        if (value == null) delete kept[column];
        else kept[column] = value;
      });
      return kept;
    }),
  };
}

export { applyQuoteToForm, applyQuoteToBaseline };
