/**
 * Validate the operator-editable payment timings (specs/online-payments-qonto.md §3.1).
 *
 * Pure: takes the raw payload from the Paiements page and returns `{ ok, errors, value }`. `value`
 * carries the cleaned, storable shape (offset arrays as number[], the rest as integers). The caller
 * persists offsets as JSON strings + the integers as columns.
 *
 * Rules: reminder offsets are arrays of whole-day deltas (negative = before the due date, 0 = the
 * due day) in [-365, 365]; every other field is a whole number of days in [0, 365]. Nothing is a
 * hard-coded delay — these are exactly the durations Adrien tunes here.
 */

const OFFSET_MIN = -365;
const OFFSET_MAX = 365;
const DAYS_MIN = 0;
const DAYS_MAX = 365;

const OFFSET_FIELDS = ['depositReminderOffsets', 'balanceReminderOffsets'];
const DAY_FIELDS = [
  'depositAbandonOffset', 'depositLinkExpiryDays',
  'balanceAbandonOffset', 'balanceLinkExpiryDays',
  'lastMinuteDays', 'fullPaymentDueDaysBefore',
];

function isWholeNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

function validatePaymentTimings(input = {}) {
  const errors = [];
  const value = {};

  for (const field of OFFSET_FIELDS) {
    if (input[field] === undefined) continue; // partial update: leave untouched
    const arr = input[field];
    if (!Array.isArray(arr)) { errors.push(`${field}: doit être une liste de jours`); continue; }
    const cleaned = arr.map(Number);
    if (!cleaned.every((n) => isWholeNumber(n) && n >= OFFSET_MIN && n <= OFFSET_MAX)) {
      errors.push(`${field}: chaque offset doit être un entier de jours entre ${OFFSET_MIN} et ${OFFSET_MAX}`);
      continue;
    }
    // De-dupe + sort ascending (earliest reminder first) for a stable stored shape.
    value[field] = Array.from(new Set(cleaned)).sort((a, b) => a - b);
  }

  for (const field of DAY_FIELDS) {
    if (input[field] === undefined) continue;
    const n = Number(input[field]);
    if (!isWholeNumber(n) || n < DAYS_MIN || n > DAYS_MAX) {
      errors.push(`${field}: doit être un entier de jours entre ${DAYS_MIN} et ${DAYS_MAX}`);
      continue;
    }
    value[field] = n;
  }

  return { ok: errors.length === 0, errors, value };
}

module.exports = { validatePaymentTimings, OFFSET_FIELDS, DAY_FIELDS };
