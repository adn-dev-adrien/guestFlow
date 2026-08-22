/**
 * Operator adjustment of the end-of-stay complement — specs/adjustable-complement-amounts.md §3.3.
 *
 * `endOfStayComplementAmount` must stay EXACTLY the sum of `endOfStayComplementDetail`: every
 * consumer downstream (the departure recap, the mid-stay remainder, the accounting line) assumes it.
 * So an adjustment is not a second amount stored beside the lines — it is a line of its own,
 * `{ label: 'Ajustement', source: 'adjustment' }`, whose amount is recomputed at every write to
 * close the gap between the real lines and what the operator announced.
 *
 * That line can be NEGATIVE (the common case: less was announced than what the departure SAS billed),
 * which is why the caller filters the real lines BEFORE calling this and appends the adjustment
 * after — the « amount > 0 » filter of the write point would otherwise drop it.
 *
 * Pure: no DB. Unit-tested in tests/end-of-stay-adjustment.unit.test.js.
 */

const ADJUSTMENT_SOURCE = 'adjustment';
const ADJUSTMENT_LABEL = 'Ajustement';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const isAdjustmentLine = (l) => Boolean(l) && l.source === ADJUSTMENT_SOURCE;

/**
 * @param {object} params
 * @param {Array} params.lines     the complement's lines, adjustment line included or not.
 * @param {number|null} params.override the announced amount, or null/'' for « no adjustment ».
 * @returns {{lines: Array, amount: number, real: number}} `amount` is the stored total, `real` the
 *          sum of the genuine lines (what the engine and the SAS produced).
 */
function reconcileEndOfStayLines({ lines = [], override = null } = {}) {
  const real = (lines || []).filter((l) => l && !isAdjustmentLine(l));
  const realTotal = round2(real.reduce((s, l) => s + Number(l.amount || 0), 0));

  const hasOverride = override !== null && override !== undefined && override !== '' && Number.isFinite(Number(override));
  if (!hasOverride) return { lines: real, amount: realTotal, real: realTotal };

  const target = Math.max(0, round2(override));
  const delta = round2(target - realTotal);
  const next = delta === 0
    ? real
    : [...real, { label: ADJUSTMENT_LABEL, qty: 1, unitPrice: delta, amount: delta, source: ADJUSTMENT_SOURCE }];
  return { lines: next, amount: target, real: realTotal };
}

module.exports = { reconcileEndOfStayLines, isAdjustmentLine, ADJUSTMENT_SOURCE, ADJUSTMENT_LABEL };
