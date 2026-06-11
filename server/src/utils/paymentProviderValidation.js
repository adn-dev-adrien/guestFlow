/**
 * Validate the Qonto payment-links provider-connection form (specs/online-payments-qonto.md §3.2 /
 * §4.3). Pure: returns `{ ok, errors, value }` with the normalized fields. Qonto requires a bank
 * account, an E.164 phone, an http(s) website, and a business description of at least 80 characters.
 */

function validateProviderConnection(input = {}) {
  const errors = [];

  const bankAccountId = String(input.bankAccountId || '').trim();
  if (!bankAccountId) errors.push('Compte bancaire requis.');

  // E.164: leading +, country digit 1-9, then 6–14 more digits. Spaces/(.)-/ are stripped first.
  const phone = String(input.phone || '').replace(/[\s().-]/g, '');
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

module.exports = { validateProviderConnection };
