/**
 * The arithmetic of the departure SAS plan (specs/sas-departure-recap-server-side.md §3.1).
 *
 * Pure functions on plain values, shared by the preview and the commit through
 * `reservationsModel.planDepartureSas`: how a stored end-of-stay line is told apart and keyed, how an
 * offered line is stored, what the recalled arrival complement is worth after the operator's gestures.
 * Nothing here reads or writes the database.
 */

const crypto = require('crypto');
const { round2, totalDiffered } = require('./arrivalSasPlan');
const { isAdjustmentLine } = require('./endOfStayAdjustment');

/** The real price of a stored line: what it is billed at, or what it would be once un-offered. */
function realOfStoredLine(line) {
  if (!line) return 0;
  return Number(line.offered || 0) === 1
    ? round2(line.originalAmount != null ? line.originalAmount : (Number(line.qty) || 1) * Number(line.unitPrice || 0))
    : round2(line.amount);
}

/**
 * The key a stored line is addressed by (rule 9): its position in the stored detail plus a short
 * fingerprint of what it is. A line rewritten between two calls changes fingerprint, so a stale key
 * matches nothing instead of silently pointing at another line.
 */
function storedLineKey(line, index) {
  const print = [String(line.label || '').trim(), realOfStoredLine(line).toFixed(2), line.source || '', line.key || ''].join('|');
  return `stored:${index}:${crypto.createHash('sha1').update(print).digest('hex').slice(0, 8)}`;
}

/**
 * Splits the stored end-of-stay detail into the lines this run REBUILDS from intent (the end-of-stay
 * ménage, the extinguisher tariffs, the priced linen) and the lines it KEEPS (rule 9): `carried`
 * (tagged `source`: deferred bath linen, mid-stay sales) and `preserved` (a label that maps to no
 * priced item). The « Ajustement » line is neither: it is recomputed at every write (rule 10).
 *
 * `pricedLabels` is the set of trimmed labels of « Facturables » linen items.
 */
function classifyStoredLines(detail, pricedLabels, cleaningLabel) {
  const carried = [];
  const preserved = [];
  const rebuilt = [];
  (Array.isArray(detail) ? detail : []).forEach((line, index) => {
    if (!line || isAdjustmentLine(line)) return;
    const entry = { line, index, key: storedLineKey(line, index) };
    const label = String(line.label || '').trim();
    if (line.source) carried.push(entry);
    else if (line.repairKey && String(line.repairKey).startsWith('extinguisher')) rebuilt.push({ ...entry, kind: 'extinguisher' });
    else if (label === cleaningLabel) rebuilt.push({ ...entry, kind: 'cleaning' });
    else if (pricedLabels.has(label)) rebuilt.push({ ...entry, kind: 'linen' });
    else preserved.push(entry);
  });
  return { carried, preserved, rebuilt };
}

/**
 * A line as the detail stores it (specs/sas-offer-complement-lines.md §3.3 rule 9): an offered line is
 * worth 0 € but keeps its real total in `originalAmount`. The real total arrives in `amount`; the
 * fallback keeps the write idempotent for an already-stored offered row.
 */
function storeLine(line) {
  const { lineKey, ...stored } = line;
  if (Number(stored.offered ? 1 : 0) !== 1) return stored;
  const sent = round2(stored.amount);
  return { ...stored, offered: 1, amount: 0, originalAmount: sent > 0 ? sent : round2(stored.originalAmount) };
}

/** The write point keeps a line that weighs something or that is offered (a gesture leaves a trace). */
function keepRealLines(lines) {
  return (lines || [])
    .filter((l) => l && !isAdjustmentLine(l))
    .filter((l) => round2(l.amount) > 0 || Number(l.offered || 0) === 1);
}

/**
 * What the recalled arrival complement is worth once this run's « Offrir » gestures are applied — the
 * mirror of `applyOfferedComplementExtras` then `reapplyComplementOverride`.
 *
 *   stored   — `complementAmount` before the run
 *   delta    — how the gestures move it (negative = offered)
 *   override — `complementAmountOverride`, or null
 *
 * `total` is what the commit leaves; `engineAmount` what the lines alone weigh.
 */
function recalledArrivalAfter({ stored, delta, override }) {
  const overridden = override != null;
  const engineAmount = delta === 0 ? round2(stored) : Math.max(0, round2(Number(stored || 0) + delta));
  const total = delta === 0 || !overridden ? engineAmount : Math.max(0, round2(override));
  return { total, engineAmount, adjusted: overridden && delta !== 0 && total !== engineAmount };
}

/** Rule 11 — is the arrival complement recalled at check-out? Something still owed on it. */
function isRecalled({ amount, paid }) {
  return Number(paid || 0) !== 1 && round2(amount) > 0;
}

module.exports = {
  round2,
  totalDiffered,
  realOfStoredLine,
  storedLineKey,
  classifyStoredLines,
  storeLine,
  keepRealLines,
  recalledArrivalAfter,
  isRecalled,
};
