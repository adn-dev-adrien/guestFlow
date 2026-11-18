/**
 * The plugin's settings (specs/gift-vouchers.md rules 22, 23), each with the check `PUT /api/plugins/:id/settings` runs. The bounds, the validity, the VAT rate and the
 * ideas of the lodging voucher are a campaign's now (specs/gift-voucher-campaigns.md rule 3, `campaignRules.js`). `pageUrl` is the site page holding the voucher (the link of the e-mail);
 * `bookingUrl` the booking page the PDF's QR code opens. Both fall back to the site's origin.
 */

const MAX_SUBJECT = 150;
const MAX_BODY = 5000;
const PLACEHOLDERS = Object.freeze(['amount', 'vat', 'expiry', 'link', 'recipientName', 'senderName', 'number']);

const DEFAULT_MAIL = Object.freeze({
  mailSubjectFr: 'Le bon cadeau de {amount} est prêt',
  mailBodyFr: 'Bonjour,\n\nLe paiement est bien reçu : le bon cadeau {number} est prêt.\n\nMontant : {amount}{vat}. Il est valable jusqu’au {expiry}.\n\nLe bon, avec son code, s’ouvre et s’imprime ici : {link}\n\nBelle journée.',
  mailSubjectEn: 'The {amount} gift voucher is ready',
  mailBodyEn: 'Hello,\n\nThe payment has been received: gift voucher {number} is ready.\n\nAmount: {amount}{vat}. It is valid until {expiry}.\n\nThe voucher and its code can be opened and printed here: {link}\n\nKind regards.',
});

function templateError(value, max, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) return `${label} : texte attendu.`;
  if (value.length > max) return `${label} : ${max} caractères au plus.`;
  const unknown = [...value.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).find((name) => !PLACEHOLDERS.includes(name));
  return unknown === undefined ? null : `${label} : « {${unknown}} » n’existe pas. Disponibles : ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`;
}

function httpsUrlError(value) {
  if (value === null || value === '') return null;
  try {
    return new URL(String(value)).protocol === 'https:' ? null : 'L’adresse doit commencer par https://.';
  } catch {
    return 'Adresse invalide.';
  }
}

const DECLARED = Object.freeze([
  { key: 'pageUrl', default: '', validate: httpsUrlError },
  { key: 'bookingUrl', default: '', validate: httpsUrlError },
  { key: 'mailSubjectFr', default: DEFAULT_MAIL.mailSubjectFr, validate: (v) => templateError(v, MAX_SUBJECT, 'Objet (français)') },
  { key: 'mailBodyFr', default: DEFAULT_MAIL.mailBodyFr, validate: (v) => templateError(v, MAX_BODY, 'Message (français)') },
  { key: 'mailSubjectEn', default: DEFAULT_MAIL.mailSubjectEn, validate: (v) => templateError(v, MAX_SUBJECT, 'Objet (anglais)') },
  { key: 'mailBodyEn', default: DEFAULT_MAIL.mailBodyEn, validate: (v) => templateError(v, MAX_BODY, 'Message (anglais)') },
]);

module.exports = { DECLARED, PLACEHOLDERS, DEFAULT_MAIL };
