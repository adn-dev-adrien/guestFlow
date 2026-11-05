const { isValidEmailAddress } = require('./emailAddress');

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
};