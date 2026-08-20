/**
 * Platform payout delay — the single source of truth for « how many days after the guest leaves is
 * the platform expected to settle » (specs/platform-payout-due-date.md §3.1 rules 6-7).
 *
 * An OTA never pays before the stay: Airbnb transfers a day after check-in, Booking invoices at the
 * month's end, Gîtes de France settles after departure. That delay is a property of the CHANNEL, not
 * of the logement — hence `platforms.payoutDueDays`, global per platform, default 10.
 *
 * Pure (no DB): the model reads the column, this module decides what a usable value is. An absent
 * row, a NULL column or garbage all collapse to the default rather than to 0 — `Number(null)` is 0,
 * which would silently make every payout due on the departure day itself.
 */

const DEFAULT_PAYOUT_DUE_DAYS = 10;
const MAX_PAYOUT_DUE_DAYS = 365;

/** Any stored or submitted value → a usable day count, falling back to the default. */
function normalizePayoutDueDays(value, fallback = DEFAULT_PAYOUT_DUE_DAYS) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PAYOUT_DUE_DAYS) return fallback;
  return Math.round(n);
}

/**
 * Strict validation for the API boundary: only an integer within range is accepted, and anything
 * else is rejected instead of being silently coerced to the default (rule 7).
 *
 * @returns {number|null} the day count, or null when the input is not a valid setting
 */
function parsePayoutDueDaysInput(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_PAYOUT_DUE_DAYS) return null;
  return n;
}

module.exports = {
  DEFAULT_PAYOUT_DUE_DAYS,
  MAX_PAYOUT_DUE_DAYS,
  normalizePayoutDueDays,
  parsePayoutDueDaysInput,
};
