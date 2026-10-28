/**
 * Input limits of the settings (specs/settings-input-guards.md rules 1, 5, 6, 8).
 *
 * A limits descriptor is `{ min, max, integer?, decimals?, unit?, message? }`. The server enforces it
 * and sends it with the payload that fills the form, so `BoundedNumberField` shows exactly the message
 * the server would answer — the client never hardcodes a bound.
 */

const PROPERTY_LIMITS = {
  depositDueDays: { min: 0, max: 30, integer: true, unit: 'jours' },
  balanceDaysBefore: { min: 0, max: 60, integer: true, unit: 'jours' },
  cancelAfterBalanceDueDays: { min: 0, max: 60, integer: true, unit: 'jours' },
  depositPercent: {
    min: 1,
    max: 99,
    decimals: 2,
    unit: '%',
    message: 'Entre 1 et 99 %. Pour tout encaisser à la réservation, désactivez l\'acompte.',
  },
};

const PLATFORM_LIMITS = {
  commissionPercent: { min: 0, max: 99.99, decimals: 2, unit: '%' },
  payoutDueDays: { min: 0, max: 365, integer: true, unit: 'jours', message: 'Un nombre entier de jours (0 à 365).' },
};

const NOT_A_NUMBER = 'Nombre attendu.';

const formatBound = (n) => String(n).replace('.', ',');

function limitMessage(limits) {
  if (limits.message) return limits.message;
  const unit = limits.unit ? ` ${limits.unit}` : '';
  return `Entre ${formatBound(limits.min)} et ${formatBound(limits.max)}${unit}.`;
}

function wholeNumberMessage(limits) {
  return limits.unit === 'jours' ? 'Nombre entier de jours.' : 'Nombre entier.';
}

// Both French and English decimal separators are read (`12,5` = `12.5`); nothing else is.
const NUMBER_PATTERN = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

/**
 * @returns {{ value: number } | { error: string }}
 * A number outside the bounds is refused, never clamped (rule 5).
 */
function parseBoundedNumber(raw, limits) {
  const text = typeof raw === 'number' ? String(raw) : String(raw == null ? '' : raw).trim();
  if (!NUMBER_PATTERN.test(text)) return { error: NOT_A_NUMBER };
  let value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value)) return { error: NOT_A_NUMBER };
  if (limits.integer) {
    if (!Number.isInteger(value)) return { error: wholeNumberMessage(limits) };
  } else if (Number.isInteger(limits.decimals)) {
    const factor = 10 ** limits.decimals;
    value = Math.round(value * factor) / factor;
  }
  if (value < limits.min || value > limits.max) return { error: limitMessage(limits) };
  return { value };
}

module.exports = { PROPERTY_LIMITS, PLATFORM_LIMITS, NOT_A_NUMBER, limitMessage, wholeNumberMessage, parseBoundedNumber };
