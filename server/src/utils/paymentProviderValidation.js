/**
 * Validate the Qonto payment-links provider-connection form (specs/online-payments-qonto.md §3.2 /
 * §4.3). Pure: returns `{ ok, errors, value }` with the normalized fields. Qonto requires a bank
 * account, an E.164 phone, an http(s) website, and a business description of at least 80 characters.
 */

// Normalise a phone to E.164, tolerating the French national form the operator naturally types:
//   "06 28 05 60 66" / "0628056066" → "+33628056066"; "0033…" → "+33…"; an already-"+…" number is
//   kept. Separators (spaces, dots, dashes, parentheses) are stripped first. Anything else is returned
//   as-is so the E.164 check below still rejects a genuinely invalid value.
function normalizePhone(raw) {
  const p = String(raw || '').replace(/[\s().-]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (/^0\d{9}$/.test(p)) return `+33${p.slice(1)}`; // French national: 0 + 9 digits → +33
  return p;
}

function validateProviderConnection(input = {}) {
  const errors = [];

  const bankAccountId = String(input.bankAccountId || '').trim();
  if (!bankAccountId) errors.push('Compte bancaire requis.');

  // E.164: leading +, country digit 1-9, then 6–14 more digits. National FR numbers are accepted and
  // normalised to +33 first (see normalizePhone).
  const phone = normalizePhone(input.phone);
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    errors.push('Téléphone invalide (format international, ex. +33612345678).');
  }

  const websiteUrl = String(input.websiteUrl || '').trim();
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(websiteUrl)) {
    errors.push('URL du site invalide (http(s)://…).');
  }

  const businessDescription = String(input.businessDescription || '').trim();
  if (businessDescription.length < 80) {
    errors.push('Description de l’activité trop courte (≥ 80 caractères).');
  }

  return { ok: errors.length === 0, errors, value: { bankAccountId, phone, websiteUrl, businessDescription } };
}

module.exports = { validateProviderConnection, normalizePhone };
