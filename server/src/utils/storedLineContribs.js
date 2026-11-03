/**
 * specs/reservation-save-keeps-pricing.md rule 20 — a save that prices without the stored snapshot (« Utiliser les
 * tarifs actuels », a change of logement) still knows what each catalogue line collected: a contrib is money
 * received, not a price. Copied onto the quote's lines by option or resource id, never onto a line forced to the
 * complement; a custom line already carries its own (rule 19). No figure of the quote depends on them.
 */
function withContribsOf(lines, stored, idField) {
  const byId = new Map((stored || []).map((line) => [Number(line[idField]), line]));
  return (lines || []).map((line) => {
    const match = byId.get(Number(line[idField]));
    if (!match || line.isCustom || line.inComplement) return line;
    return { ...line, acompteContribTtc: match.acompteContribTtc ?? null, soldeContribTtc: match.soldeContribTtc ?? null };
  });
}

function withStoredLineContribs(quote, { lockedOptionLines, lockedResourceLines }) {
  return {
    ...quote,
    optionLines: withContribsOf(quote.optionLines, lockedOptionLines, 'optionId'),
    resourceLines: withContribsOf(quote.resourceLines, lockedResourceLines, 'resourceId'),
  };
}

module.exports = { withStoredLineContribs };
