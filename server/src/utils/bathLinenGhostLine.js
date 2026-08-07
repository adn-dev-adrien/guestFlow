/**
 * Ghost bath-linen line in the end-of-stay complement — specs/sas-bath-linen-ghost-line.md.
 *
 * The arrival SAS used to offer « linge de toilette réglé en fin de séjour », which wrote a billing
 * line into `reservations.endOfStayComplementDetail` instead of a line on the fiche. When the option
 * was later activated on the reservation, the same service was billed by BOTH buckets (the merged
 * « complément de fin de séjour » showed it twice).
 *
 * The choice is gone from the UI since #366; the invariant is now explicit: everything the arrival
 * SAS sells is a line on the reservation fiche, never a parallel billing line. This helper erases the
 * exception wherever it is still stored.
 *
 * Pure: takes the raw column, returns what to persist (or `null` when there is nothing to do).
 */

const GHOST_SOURCE = 'arrivalBathLinen';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseDetail(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * @param {string|Array|null} detailRaw  `endOfStayComplementDetail` as stored.
 * @returns {{ detail: Array, amount: number, dropped: number }|null}
 *          `null` when no ghost line is present (nothing to write).
 */
function dropBathLinenGhost(detailRaw) {
  const lines = parseDetail(detailRaw);
  const kept = lines.filter((l) => !(l && l.source === GHOST_SOURCE));
  if (kept.length === lines.length) return null;
  return {
    detail: kept,
    amount: Math.max(0, round2(kept.reduce((s, l) => s + (Number(l && l.amount) || 0), 0))),
    dropped: lines.length - kept.length,
  };
}

module.exports = { GHOST_SOURCE, dropBathLinenGhost };
