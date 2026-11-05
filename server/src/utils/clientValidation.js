const { isValidEmailAddress } = require('./emailAddress');
const { cleanedBody } = require('./bodyText');

function isValidEmail(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return isValidEmailAddress(trimmed);
}

function isValidPhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;

  const normalized = trimmed.replace(/[\s().-]/g, '');
  if (normalized.startsWith('+')) {
    return /^\+[0-9]{8,15}$/.test(normalized);
  }

  return /^[0-9]{10,15}$/.test(normalized);
}

// Only a string is text: an object used to be stored as « [object Object] » (specs/hosting-h2-account-security.md
// rule 68).
const TEXT_FIELDS = ['lastName', 'firstName', 'streetNumber', 'street', 'postalCode', 'city', 'address', 'phone', 'email', 'notes', 'emailLanguage'];

/** Audit R23-I8 — NUL used to read as a blank name in the lists: control characters out, a stored value left as it is. A pasted tab separates words: a space. */
const cleanClientText = (payload, stored = null) => cleanedBody(payload || {}, { fields: TEXT_FIELDS, lineFields: ['notes'], stored, tabAsSpace: true });

function validateClientPayload(payload) {
  if (TEXT_FIELDS.some((field) => payload?.[field] !== undefined && payload[field] !== null && typeof payload[field] !== 'string')) {
    return 'Valeur invalide.';
  }
  const email = String(payload?.email || '').trim();
  const phone = String(payload?.phone || '').trim();

  if (!isValidEmail(email)) {
    return 'Adresse email invalide.';
  }

  if (!isValidPhone(phone)) {
    return 'Numéro de téléphone invalide.';
  }

  return '';
}

module.exports = {
  isValidEmail,
  isValidPhone,
  validateClientPayload,
  cleanClientText,
};