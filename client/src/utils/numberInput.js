// Input ergonomics for bounded number fields (specs/settings-input-guards.md rules 2, 4-6, 8).
// Pure presentation of a limits descriptor `{ min, max, integer?, decimals?, unit?, message? }` the
// server sends; the server stays the authority and answers the same messages.

const NUMBER_PATTERN = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

// Only the hyphen-minus and the real minus sign: a dash pasted from elsewhere is « not a number », not « a minus ».
export const stripMinus = (text) => String(text).replace(/[-\u2212]/g, '');

/** Reads « 12,5 » and « 12.5 » alike; NaN for anything that is not a number. */
export function parseLocaleNumber(text) {
  const clean = String(text == null ? '' : text).trim();
  return NUMBER_PATTERN.test(clean) ? Number(clean.replace(',', '.')) : NaN;
}

const formatBound = (n) => String(n).replace('.', ',');

export function limitMessage(limits) {
  if (limits.message) return limits.message;
  const unit = limits.unit ? ` ${limits.unit}` : '';
  return `Entre ${formatBound(limits.min)} et ${formatBound(limits.max)}${unit}.`;
}

/** The refusal a committed number deserves, or '' when it is acceptable. */
export function rangeError(value, limits) {
  if (value === '' || value == null || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  if (limits.integer && !Number.isInteger(n)) return limits.unit === 'jours' ? 'Nombre entier de jours.' : 'Nombre entier.';
  if (!limits.integer && Number.isInteger(limits.decimals) && (String(value).split('.')[1] || '').length > limits.decimals) {
    return `Au plus ${limits.decimals} décimale${limits.decimals > 1 ? 's' : ''}.`;
  }
  return n < limits.min || n > limits.max ? limitMessage(limits) : '';
}

export function toDisplay(value) {
  return value === '' || value == null ? '' : String(value).replace('.', ',');
}
