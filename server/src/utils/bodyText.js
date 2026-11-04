/**
 * Reading a JSON body's fields (specs/hosting-h2-account-security.md rule 68), as the console does
 * (control-plane/server/src/utils/bodyText.js). `String()` and `Number()` throw on {"toString":1} and turn `{}` into
 * stored text; only a string is text, only a number or a string is a number. Absent and `null` read as empty, so a
 * form's untouched optional field stays fine.
 */

const NOT_TEXT = 'Texte attendu.';
const isAbsent = (value) => value === undefined || value === null;

/** A value compared or required: anything but a string reads as empty, and the caller's own refusal answers. */
const asText = (value) => (typeof value === 'string' ? value : '');

/** A form field: the refusal joins `errors`; the value comes back trimmed. */
function fieldText(body, key, errors, { max } = {}) {
  const value = body[key];
  if (!isAbsent(value) && typeof value !== 'string') {
    errors[key] = NOT_TEXT;
    return '';
  }
  const trimmed = (value || '').trim();
  if (max && trimmed.length > max) errors[key] = `${max} caractères au plus.`;
  return trimmed;
}

/** Optional text: absent, null or a string; anything else is a refusal. */
const isOptionalText = (value) => isAbsent(value) || typeof value === 'string';

const numeric = (value) => (typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN);

/** A row id: a positive integer, or its digits. Anything else is null. */
function positiveId(value) {
  const n = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A tick, as INVALID_PAYMENT_FLAG reads it: true, false, 1 or 0. */
const isFlag = (value) => value === true || value === false || value === 1 || value === 0;

/** A time of day: HH:MM. */
const isClockTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** A query string's values: a repeated key arrives as an array, and reads as not sent. */
const scalarQuery = (query) => Object.fromEntries(Object.entries(query || {}).filter(([, value]) => typeof value === 'string'));

module.exports = { asText, fieldText, isOptionalText, numeric, positiveId, isFlag, isClockTime, scalarQuery };
