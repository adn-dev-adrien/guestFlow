/**
 * Reading a JSON body's fields (specs/control-plane-plans-and-access.md rule 48). `String()` and `Number()` throw
 * on {"toString":1} and turn `null` or `{}` into stored text; only a string is text, only a number or a string is
 * a number. Absent and `null` read as empty, so a form's untouched optional field stays fine.
 */

const { httpError } = require('./httpError');

const NOT_TEXT = 'Texte attendu.';
const isAbsent = (value) => value === undefined || value === null;

/** A value compared or required: anything but a string reads as empty, and the caller's own refusal answers. */
const asText = (value) => (typeof value === 'string' ? value : '');

/** An optional field: a non-string is that field's 400. */
function text(body, key) {
  const value = body[key];
  if (isAbsent(value)) return '';
  if (typeof value !== 'string') throw httpError(400, 'INVALID', NOT_TEXT, { errors: { [key]: NOT_TEXT } });
  return value;
}

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

const numeric = (value) => (typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN);

module.exports = { asText, text, fieldText, numeric };
