/**
 * Pure validators for monetary inputs at write/quote boundaries.
 *
 * These reject values that must never reach the pricing engine or the database:
 * non-finite numbers, negative amounts, and out-of-range percentages. They return
 * a machine error code (string) on failure or `null` when the value is acceptable.
 *
 * Reused by the pricing entry point now and by other write boundaries in Bloc S.
 */

const { readNumber, usableNumber } = require('./lineInputBounds');

const ERROR_NOT_A_NUMBER = 'NOT_A_NUMBER';
const ERROR_NEGATIVE_AMOUNT = 'NEGATIVE_AMOUNT';
const ERROR_INVALID_PERCENTAGE = 'INVALID_PERCENTAGE';
const ERROR_GROSS_BELOW_NET = 'GROSS_BELOW_NET';

// An optional money field: text of spaces is as empty as ''. A count or a line refuses it (`readNumber`).
const readOptionalNumber = (value) => (typeof value === 'string' && value.trim() === '' ? undefined : readNumber(value));

/**
 * Treats empty/undefined/null as "not provided" (valid) so optional money fields
 * can be omitted. Any provided value must be a usable, non-negative number, or numeric text.
 */
function validateMoneyAmount(value) {
  const n = readOptionalNumber(value);
  if (n === undefined) return null;
  if (!usableNumber(n)) return ERROR_NOT_A_NUMBER;
  if (n < 0) return ERROR_NEGATIVE_AMOUNT;
  return null;
}

/**
 * Optional percentage; when provided must be a usable number within [0, 100], or numeric text.
 */
function validatePercentage(value) {
  const n = readOptionalNumber(value);
  if (n === undefined) return null;
  if (!usableNumber(n)) return ERROR_NOT_A_NUMBER;
  if (n < 0 || n > 100) return ERROR_INVALID_PERCENTAGE;
  return null;
}

/**
 * Platform gross (what the guest paid the platform) must be ≥ the `reference` the caller passes —
 * the **balance** (solde), i.e. what the platform actually covers (the extras/complément are
 * collected on arrival, not via the platform). Below-reference implies a negative platform
 * commission, which is nonsensical. Both null/empty/undefined → "not provided" → valid.
 * (Param kept named `net` for back-compat; callers now pass `quote.balanceAmount`.)
 */
function validateClientGrossAmount(gross, net) {
  const grossError = validateMoneyAmount(gross);
  if (grossError || readOptionalNumber(gross) === undefined) return grossError;
  const g = readOptionalNumber(gross);
  if (net === '' || net === null || net === undefined) return null;
  const n = Number(net);
  if (Number.isFinite(n) && g < n) return ERROR_GROSS_BELOW_NET;
  return null;
}

/**
 * Validates a map of { field: { value, kind } } where kind is 'money' | 'percentage'.
 * Returns the first error code found, or null when all pass. A value `stored` holds under the same
 * field name, sent back unchanged, is not re-judged (D6's reading).
 */
function validateFinanceInputs(fields, stored = null) {
  for (const [field, descriptor] of Object.entries(fields || {})) {
    if (!descriptor) continue;
    const { value, kind } = descriptor;
    if (stored && stored[field] != null && readNumber(value) === Number(stored[field])) continue;
    const error = kind === 'percentage' ? validatePercentage(value) : validateMoneyAmount(value);
    if (error) return error;
  }
  return null;
}

const STAY_MONEY_FIELDS = [
  'customPrice', 'depositAmount', 'depositAmountOverride', 'complementAmountOverride',
  'endOfStayComplementAmountOverride', 'balanceAmount', 'cautionAmount', 'platformCommissionAmount',
  'acompteCommissionAmount', 'platformGrossAmount', 'platformPayoutAmount', 'platformTouristTaxAmount',
];

/**
 * The money of a stay or devis write, one list for the quote, the create, the update and the devis:
 * the preview refuses what the save refuses (specs/reservations-backend-mvc.md rule 19).
 */
function validateStayFinance(body, stored = null) {
  const fields = { discountPercent: { value: body?.discountPercent, kind: 'percentage' } };
  for (const field of STAY_MONEY_FIELDS) fields[field] = { value: body?.[field], kind: 'money' };
  return validateFinanceInputs(fields, stored);
}

// The refusal the operator reads (specs/editable-deposit-amount.md rule 9): French text in `error`, the
// machine code kept in `code` for callers that branch on it.
const FINANCE_ERROR_MESSAGES = {
  [ERROR_NOT_A_NUMBER]: 'Montant invalide : saisir un nombre.',
  [ERROR_NEGATIVE_AMOUNT]: 'Un montant ne peut pas être négatif.',
  [ERROR_INVALID_PERCENTAGE]: 'Pourcentage invalide : entre 0 et 100.',
  [ERROR_GROSS_BELOW_NET]: 'Le brut ne peut pas être inférieur au solde.',
};

function financeErrorBody(code) {
  return { error: FINANCE_ERROR_MESSAGES[code] || 'Montant invalide.', code };
}

module.exports = {
  financeErrorBody,
  validateMoneyAmount,
  validatePercentage,
  validateClientGrossAmount,
  validateFinanceInputs,
  validateStayFinance,
  ERROR_NOT_A_NUMBER,
  ERROR_NEGATIVE_AMOUNT,
  ERROR_INVALID_PERCENTAGE,
  ERROR_GROSS_BELOW_NET,
};
