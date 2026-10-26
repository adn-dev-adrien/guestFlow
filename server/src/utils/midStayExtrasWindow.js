/**
 * Extras sold on a LOCKED fiche — specs/mid-stay-extras-on-locked-fiche.md.
 *
 * From its check-in date a reservation is locked, yet extras are routinely sold to a guest who is
 * already on site. This module owns the pure rules of that door: when it is open (rule 1), which
 * lines sold at arrival cannot move (rules 6 and 13) and which saves break that (rule 6).
 * No DB, no clock: the callers pass the row, the lines and today's date.
 *
 * Lines are keyed like the arrival baseline (`extraLineKey`): `opt:<id>`, `res:<id>`,
 * `custom:<label>`. Several lines on one key are aggregated on both sides of every comparison.
 */

const { extraLineKey, parseBaseline } = require('./midStayExtras');

const EPSILON = 0.001;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ceil2 = (n) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;

const isEndOfStayCollected = (row) => Number(row.endOfStayComplementPaid || 0) === 1
  || Number(row.endOfStayComplementPaidCash || 0) === 1;

/**
 * Rule 1 — a reservation is open for mid-stay extras when it is locked (`startDate <= today`), is a
 * live reservation, and its end-of-stay complement has not been collected.
 * @returns {{ locked: boolean, extrasEditable: boolean, extrasClosedReason: string|null }}
 */
function midStayExtrasWindow(row, today) {
  const locked = Boolean(row && row.startDate && row.startDate <= today);
  if (!locked) return { locked: false, extrasEditable: false, extrasClosedReason: null };
  if (String(row.kind || 'reservation') !== 'reservation') {
    return { locked, extrasEditable: false, extrasClosedReason: null };
  }
  if (isEndOfStayCollected(row)) {
    return { locked, extrasEditable: false, extrasClosedReason: 'endOfStayCollected' };
  }
  return { locked, extrasEditable: true, extrasClosedReason: null };
}

function isMidStayExtrasWindowOpen(row, today) {
  return midStayExtrasWindow(row, today).extrasEditable;
}

// Per key: units, billed amount, and whether every line of the key is offered.
function aggregateByKey(lines) {
  const byKey = new Map();
  for (const line of (lines || [])) {
    const key = extraLineKey(line);
    if (!key) continue;
    const quantity = line.isCustom || line.customKey != null || line.customOptionId != null
      ? 1
      : Number(line.quantity == null ? 1 : line.quantity);
    const offered = Number(line.offered || 0) === 1 || line.offered === true;
    const entry = byKey.get(key) || { quantity: 0, total: 0, offeredCount: 0, count: 0, hourly: false };
    if (line.hourly) entry.hourly = true;
    entry.quantity = round2(entry.quantity + (Number.isFinite(quantity) ? quantity : 1));
    entry.total = round2(entry.total + (offered ? 0 : Number(line.totalPrice || 0)));
    entry.count += 1;
    if (offered) entry.offeredCount += 1;
    byKey.set(key, entry);
  }
  return byKey;
}

const isAllOffered = (entry) => entry.count > 0 && entry.offeredCount === entry.count;

/**
 * Rules 6 and 13 — the lines the save may not remove nor reduce.
 * `minQuantity` is the stored quantity itself while the line has not been extended past its arrival
 * amount (the usual case, and exact). Once extended, it is the proportional estimate — baseline amount
 * over the amount per unit — rounded UP to a whole unit, or to 0.01 for an hourly resource. The
 * amount check of `arrivalExtrasViolations` stays the real guard. An offered line present before is
 * frozen at its current quantity. No baseline → nothing is frozen.
 * `reason` tells the fiche which caption to print.
 * @returns {Object<string, { minQuantity: number, frozen: true, reason: 'arrival'|'offered' }>}
 */
function arrivalLineFloors(baselineRaw, beforeLines) {
  const baseline = parseBaseline(baselineRaw);
  if (!baseline) return {};
  const floors = {};
  for (const [key, entry] of aggregateByKey(beforeLines)) {
    if (isAllOffered(entry)) {
      floors[key] = { minQuantity: entry.quantity, frozen: true, reason: 'offered' };
      continue;
    }
    const arrivalAmount = Number(baseline[key] || 0);
    if (arrivalAmount <= 0 || entry.quantity <= 0 || entry.total <= 0) continue;
    let minQuantity = entry.quantity;
    if (entry.total > arrivalAmount + 0.005) {
      const estimate = arrivalAmount / (entry.total / entry.quantity);
      const rounded = entry.hourly ? ceil2(estimate) : Math.ceil(estimate - 1e-9);
      minQuantity = Math.min(entry.quantity, Math.max(rounded, Math.min(1, entry.quantity)));
    }
    floors[key] = { minQuantity, frozen: true, reason: 'arrival' };
  }
  return floors;
}

/**
 * Rule 6 — what the submitted lines break. Empty array = the save respects what was sold at arrival.
 * @returns {Array<{ key: string, reason: 'removed'|'reduced'|'offered'|'unoffered' }>}
 */
function arrivalExtrasViolations(baselineRaw, beforeLines, afterLines) {
  const baseline = parseBaseline(baselineRaw) || {};
  const floors = arrivalLineFloors(baselineRaw, beforeLines);
  const after = aggregateByKey(afterLines);
  const violations = [];
  for (const [key, floor] of Object.entries(floors)) {
    const next = after.get(key);
    if (!next) { violations.push({ key, reason: 'removed' }); continue; }
    const wasOffered = floor.reason === 'offered';
    if (wasOffered && !isAllOffered(next)) { violations.push({ key, reason: 'unoffered' }); continue; }
    if (!wasOffered && isAllOffered(next)) { violations.push({ key, reason: 'offered' }); continue; }
    if (next.quantity + EPSILON < floor.minQuantity) { violations.push({ key, reason: 'reduced' }); continue; }
    // The amount is the line's real price: fewer served persons, a lower price or a lost free allowance
    // all shrink it without touching the quantity.
    if (!wasOffered && next.total + 0.005 < Number(baseline[key] || 0)) violations.push({ key, reason: 'reduced' });
  }
  return violations;
}

/** True when the extras differ in content (units, amount, offered), not merely in routing. */
function extrasContentChanged(beforeLines, afterLines) {
  const before = aggregateByKey(beforeLines);
  const after = aggregateByKey(afterLines);
  if (before.size !== after.size) return true;
  for (const [key, entry] of before) {
    const next = after.get(key);
    if (!next || Math.abs(next.quantity - entry.quantity) > EPSILON
      || Math.abs(next.total - entry.total) > 0.005 || next.offeredCount !== entry.offeredCount) return true;
  }
  return false;
}

// Ids of the persisted custom lines whose key is frozen: the fiche freezes by id, never by label.
function frozenCustomOptionIds(floors, beforeLines) {
  return (beforeLines || [])
    .filter((line) => line.isCustom && line.customOptionId != null && floors[extraLineKey(line)])
    .map((line) => Number(line.customOptionId));
}

// A planning-card option counts one unit per scheduled moment: the first `minQuantity` moments are
// the ones sold at arrival and cannot be unchecked; later ones can still be (or be added).
function withLockedOccurrences(floors, beforeLines) {
  const out = {};
  for (const [key, floor] of Object.entries(floors)) {
    const line = (beforeLines || []).find((l) => !l.isCustom && l.optionId != null && extraLineKey(l) === key);
    const moments = line && Array.isArray(line.occurrences) ? line.occurrences : [];
    out[key] = moments.length === 0 ? floor : {
      ...floor,
      lockedOccurrences: [...moments]
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
        .slice(0, Math.floor(floor.minQuantity)),
    };
  }
  return out;
}

/** Read-side payload of rule 13. */
function buildEditLock(row, today, baselineRaw, beforeLines) {
  const window = midStayExtrasWindow(row, today);
  const arrivalLines = window.extrasEditable ? withLockedOccurrences(arrivalLineFloors(baselineRaw, beforeLines), beforeLines) : {};
  return {
    ...window,
    arrivalLines,
    frozenCustomOptionIds: window.extrasEditable ? frozenCustomOptionIds(arrivalLines, beforeLines) : [],
  };
}

module.exports = {
  midStayExtrasWindow,
  isMidStayExtrasWindowOpen,
  arrivalLineFloors,
  arrivalExtrasViolations,
  extrasContentChanged,
  buildEditLock,
};
