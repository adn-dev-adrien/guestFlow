/**
 * Pure validators for monetary inputs at write/quote boundaries.
 *
 * These reject values that must never reach the pricing engine or the database:
 * non-finite numbers, negative amounts, and out-of-range percentages. They return
 * a machine error code (string) on failure or `null` when the value is acceptable.
 *
 * Reused by the pricing entry point now and by other write boundaries in Bloc S.
 */

const ERROR_NOT_A_NUMBER = 'NOT_A_NUMBER';
const ERROR_NEGATIVE_AMOUNT = 'NEGATIVE_AMOUNT';
const ERROR_INVALID_PERCENTAGE = 'INVALID_PERCENTAGE';
const ERROR_GROSS_BELOW_NET = 'GROSS_BELOW_NET';

/**
 * Treats empty/undefined/null as "not provided" (valid) so optional money fields
 * can be omitted. Any provided value must be a finite, non-negative number.
 */
function validateMoneyAmount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return ERROR_NOT_A_NUMBER;
  if (n < 0) return ERROR_NEGATIVE_AMOUNT;
  return null;
}

/**
 * Optional percentage; when provided must be a finite number within [0, 100].
 */
function validatePercentage(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return ERROR_NOT_A_NUMBER;
  if (n < 0 || n > 100) return ERROR_INVALID_PERCENTAGE;
  return null;
}

/**
 * Platform gross (what the guest paid the platform) must be ≥ the owner's net (`finalPrice`); the
 * difference IS the commission. Below-net implies a negative commission, which is nonsensical.
 * Both null/empty/undefined → "not provided" → valid.
 */
function validateClientGrossAmount(gross, net) {
  if (gross === '' || gross === null || gross === undefined) return null;
  const g = Number(gross);
  if (!Number.isFinite(g)) return ERROR_NOT_A_NUMBER;
  if (g < 0) return ERROR_NEGATIVE_AMOUNT;
  if (net === '' || net === null || net === undefined) return null;
  const n = Number(net);
  if (Number.isFinite(n) && g < n) return ERROR_GROSS_BELOW_NET;
  return null;
}

/**
 * Validates a map of { field: { value, kind } } where kind is 'money' | 'percentage'.
 * Returns the first error code found, or null when all pass.
 */
function validateFinanceInputs(fields) {
  for (const [, descriptor] of Object.entries(fields || {})) {
    if (!descriptor) continue;
    const { value, kind } = descriptor;
    const error = kind === 'percentage' ? validatePercentage(value) : validateMoneyAmount(value);
    if (error) return error;
  }
  return null;
}

module.exports = {
  validateMoneyAmount,
  validatePercentage,
  validateClientGrossAmount,
  validateFinanceInputs,
  ERROR_NOT_A_NUMBER,
  ERROR_NEGATIVE_AMOUNT,
  ERROR_INVALID_PERCENTAGE,
  ERROR_GROSS_BELOW_NET,
};
