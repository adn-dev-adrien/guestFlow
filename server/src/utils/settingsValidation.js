/**
 * Settings validation — pure functions, unit-testable.
 *
 * Each validator returns null when the value is valid (including empty), or a
 * French error string when invalid. The controller decides separately whether
 * an empty value is acceptable for a given field.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PEM_BEGIN_REGEX = /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/m;
const PEM_END_REGEX = /-----END [A-Z0-9 ]*PRIVATE KEY-----\s*$/m;
const TVA_REGEX = /^[A-Z]{2}\d+$/;
const BIC_REGEX = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

function trimOrEmpty(value) {
  return String(value == null ? '' : value).trim();
}

function stripWhitespace(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '');
}

function validateEmail(value) {
  const v = trimOrEmpty(value);
  if (v === '') return null;
  if (!EMAIL_REGEX.test(v)) return 'Email invalide.';
  return null;
}

function validateSiret(value) {
  const v = stripWhitespace(value);
  if (v === '') return null;
  if (!/^\d{14}$/.test(v)) return 'Le SIRET doit contenir 14 chiffres.';
  return null;
}

function validateTvaIntracom(value) {
  const v = stripWhitespace(value).toUpperCase();
  if (v === '') return null;
  if (!TVA_REGEX.test(v)) return 'Format TVA invalide (ex : FR12345678901).';
  return null;
}

// IBAN mod-97 check (per ISO 13616).
function validateIban(value) {
  const v = stripWhitespace(value).toUpperCase();
  if (v === '') return null;
  if (v.length < 15 || v.length > 34) return 'IBAN invalide.';
  // Rearrange: move first 4 chars to the end.
  const rearranged = v.slice(4) + v.slice(0, 4);
  // Convert letters to numbers (A=10, B=11, ..., Z=35).
  let numeric = '';
  for (let i = 0; i < rearranged.length; i += 1) {
    const ch = rearranged[i];
    if (/[A-Z]/.test(ch)) numeric += String(ch.charCodeAt(0) - 55);
    else if (/\d/.test(ch)) numeric += ch;
    else return 'IBAN invalide.';
  }
  // Compute mod 97 using chunked big-int math (BigInt would also work).
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = String(remainder) + numeric.slice(i, i + 7);
    remainder = Number(chunk) % 97;
  }
  if (remainder !== 1) return 'IBAN invalide.';
  return null;
}

function validateBic(value) {
  const v = stripWhitespace(value).toUpperCase();
  if (v === '') return null;
  if (!BIC_REGEX.test(v)) return 'BIC invalide (8 ou 11 caractères).';
  return null;
}

function validatePrivateKey(value) {
  const v = trimOrEmpty(value);
  if (v === '') return null;
  if (!PEM_BEGIN_REGEX.test(v)) {
    return 'Clé d\'authentification invalide : marqueur de début "-----BEGIN ... PRIVATE KEY-----" introuvable.';
  }
  if (!PEM_END_REGEX.test(v)) {
    return 'Clé d\'authentification invalide : marqueur de fin "-----END ... PRIVATE KEY-----" introuvable.';
  }
  return null;
}

function validateCalendarId(value) {
  const v = trimOrEmpty(value);
  if (v === '') return null;
  if (v.length > 500) return 'Identifiant de calendrier trop long.';
  return null;
}

function validateQuoteValidityDays(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Doit être un entier entre 1 et 365.';
  if (n < 1 || n > 365) return 'Doit être un entier entre 1 et 365.';
  return null;
}

function validateVatRate(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Doit être un nombre entre 0 et 100.';
  if (n < 0 || n > 100) return 'Doit être un nombre entre 0 et 100.';
  return null;
}

// SMTP validators (specs/admin-account-management.md M3).
function validateSmtpPort(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Doit être un entier entre 1 et 65535.';
  if (n < 1 || n > 65535) return 'Doit être un entier entre 1 et 65535.';
  return null;
}

function validatePublicUrl(value) {
  if (value == null || value === '') return null;
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Doit commencer par http:// ou https://.';
    return null;
  } catch (_) {
    return 'URL invalide.';
  }
}

module.exports = {
  validateEmail,
  validateSiret,
  validateTvaIntracom,
  validateIban,
  validateBic,
  validatePrivateKey,
  validateCalendarId,
  validateQuoteValidityDays,
  validateVatRate,
  validateSmtpPort,
  validatePublicUrl,
  // exported for tests
  __test: { trimOrEmpty, stripWhitespace },
};
