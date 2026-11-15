/**
 * The plugin's settings (specs/gift-vouchers.md rules 6, 7, 14, 22, 23), each with the check `PUT /api/plugins/:id/settings` runs.
 * `pageUrl` is the site page holding the voucher (the link of the e-mail); `bookingUrl` the booking page the PDF's QR code opens.
 * Both fall back to the site's origin.
 */

const rules = require('./voucherRules');

const MAX_IDEAS = 6;
const MAX_IDEA_LABEL = 60;
const MAX_NIGHTS = 60;
const MAX_GUESTS = 30;
const MAX_SUBJECT = 150;
const MAX_BODY = 5000;
const PLACEHOLDERS = Object.freeze(['amount', 'expiry', 'link', 'recipientName', 'senderName', 'number']);
const IDEA_KEYS = Object.freeze(['label', 'propertyId', 'nights', 'guests']);

const DEFAULT_MAIL = Object.freeze({
  mailSubjectFr: 'Le bon cadeau de {amount} est prêt',
  mailBodyFr: 'Bonjour,\n\nLe paiement est bien reçu : le bon cadeau {number} de {amount} est prêt. Il est valable jusqu’au {expiry}.\n\nLe bon, avec son code, s’ouvre et s’imprime ici : {link}\n\nBelle journée.',
  mailSubjectEn: 'The {amount} gift voucher is ready',
  mailBodyEn: 'Hello,\n\nThe payment has been received: gift voucher {number} for {amount} is ready. It is valid until {expiry}.\n\nThe voucher and its code can be opened and printed here: {link}\n\nKind regards.',
});

const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const asNumber = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);

function intError(value, { min, max, message }) {
  const n = asNumber(value);
  return Number.isInteger(n) && n >= min && n <= max ? null : message;
}

/** The ideas as a list, from the stored JSON or a list: null when it is neither. */
function parseIdeas(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Rule 14 — an idea is always a stay to price, never a bare amount (Adrien, 2026-11-15). */
function ideasError(value) {
  const list = parseIdeas(value);
  if (!list) return 'Les idées doivent être une liste de séjours.';
  if (list.length > MAX_IDEAS) return `Au plus ${MAX_IDEAS} idées.`;
  for (const idea of list) {
    if (!idea || typeof idea !== 'object' || Array.isArray(idea)) return 'Chaque idée est un séjour : libellé, logement, nuits, personnes.';
    if (Object.keys(idea).some((k) => !IDEA_KEYS.includes(k))) return 'Une idée est un séjour à chiffrer, jamais un montant : libellé, logement, nuits, personnes.';
    if (typeof idea.label !== 'string' || !idea.label.trim() || idea.label.length > MAX_IDEA_LABEL) return `Le libellé d’une idée fait de 1 à ${MAX_IDEA_LABEL} caractères.`;
    if (!isPositiveInt(idea.propertyId)) return 'Chaque idée désigne un logement.';
    if (!isPositiveInt(idea.nights) || idea.nights > MAX_NIGHTS) return `Le nombre de nuits d’une idée va de 1 à ${MAX_NIGHTS}.`;
    if (!isPositiveInt(idea.guests) || idea.guests > MAX_GUESTS) return `Le nombre de personnes d’une idée va de 1 à ${MAX_GUESTS}.`;
  }
  return null;
}

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
  {
    key: 'validityMonths',
    default: String(rules.DEFAULT_VALIDITY_MONTHS),
    validate: (v) => intError(v, { min: 1, max: rules.MAX_VALIDITY_MONTHS, message: `La validité va de 1 à ${rules.MAX_VALIDITY_MONTHS} mois.` }),
  },
  {
    key: 'minAmountCents',
    default: String(rules.DEFAULT_MIN_CENTS),
    validate: (v) => intError(v, { min: 100, max: 10000000, message: 'Montant minimal invalide (en centimes, au moins 1 €).' }),
  },
  {
    key: 'maxAmountCents',
    default: String(rules.DEFAULT_MAX_CENTS),
    validate: (v) => intError(v, { min: 100, max: 10000000, message: 'Montant maximal invalide (en centimes, au plus 100 000 €).' }),
  },
  { key: 'ideas', default: '[]', validate: ideasError },
  { key: 'pageUrl', default: '', validate: httpsUrlError },
  { key: 'bookingUrl', default: '', validate: httpsUrlError },
  { key: 'mailSubjectFr', default: DEFAULT_MAIL.mailSubjectFr, validate: (v) => templateError(v, MAX_SUBJECT, 'Objet (français)') },
  { key: 'mailBodyFr', default: DEFAULT_MAIL.mailBodyFr, validate: (v) => templateError(v, MAX_BODY, 'Message (français)') },
  { key: 'mailSubjectEn', default: DEFAULT_MAIL.mailSubjectEn, validate: (v) => templateError(v, MAX_SUBJECT, 'Objet (anglais)') },
  { key: 'mailBodyEn', default: DEFAULT_MAIL.mailBodyEn, validate: (v) => templateError(v, MAX_BODY, 'Message (anglais)') },
]);

/** The bounds and validity in force: a min above the max (settings are judged one key at a time) falls back to the defaults. */
function limitsOf(get) {
  const num = (key, fallback) => { const n = Number(get(key)); return Number.isInteger(n) && n > 0 ? n : fallback; };
  const minAmountCents = num('minAmountCents', rules.DEFAULT_MIN_CENTS);
  const maxAmountCents = num('maxAmountCents', rules.DEFAULT_MAX_CENTS);
  return {
    validityMonths: Math.min(num('validityMonths', rules.DEFAULT_VALIDITY_MONTHS), rules.MAX_VALIDITY_MONTHS),
    ...(minAmountCents <= maxAmountCents
      ? { minAmountCents, maxAmountCents }
      : { minAmountCents: rules.DEFAULT_MIN_CENTS, maxAmountCents: rules.DEFAULT_MAX_CENTS }),
  };
}

/** The stored ideas, as a list; an unreadable value is no idea at all. */
const ideasOf = (get) => (ideasError(get('ideas')) ? [] : parseIdeas(get('ideas')));

module.exports = {
  DECLARED, PLACEHOLDERS, DEFAULT_MAIL, MAX_IDEAS, ideasError, ideasOf, limitsOf, parseIdeas,
};
