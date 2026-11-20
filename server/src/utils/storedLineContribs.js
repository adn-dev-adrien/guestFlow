/**
 * specs/reservation-save-keeps-pricing.md rule 20 — a save that prices without the stored snapshot (« Utiliser les
 * tarifs actuels », a change of logement) still knows what each catalogue line collected: a contrib is money
 * received, not a price. Copied onto the quote's lines by option or resource id, never onto a line forced to the
 * complement; a custom line already carries its own (rule 19). No figure of the quote depends on them.
 */
function withContribsOf(lines, stored, idField) {
  // Rule 85: a later sale of an article names its own stored line; the first one takes the article's first.
  const byId = new Map();
  for (const line of stored || []) {
    const held = byId.get(Number(line[idField]));
    if (!held || (line.lineId != null && (held.lineId == null || Number(line.lineId) < Number(held.lineId)))) byId.set(Number(line[idField]), line);
  }
  const byLine = new Map((stored || []).filter((line) => line.lineId != null).map((line) => [Number(line.lineId), line]));
  return (lines || []).map((line) => {
    const match = (line.lineId != null && byLine.get(Number(line.lineId))) || byId.get(Number(line[idField]));
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
