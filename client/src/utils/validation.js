// Mirrors server/src/utils/emailAddress.js (the server stays the authority): the length first, then
// no overlapping quantifiers — a long dotted string must never stall the tab.
const MAX_EMAIL_LENGTH = 254;
const FORBIDDEN_EMAIL_CHARS = /[\s@,;<>"]/;

export function isValidEmail(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  if (trimmed.length < 5 || trimmed.length > MAX_EMAIL_LENGTH) return false;
  const at = trimmed.indexOf('@');
  if (at < 1) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (FORBIDDEN_EMAIL_CHARS.test(local) || FORBIDDEN_EMAIL_CHARS.test(domain)) return false;
  const dot = domain.lastIndexOf('.');
  return dot >= 1 && dot <= domain.length - 2;
}

export function isValidPhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;

  const normalized = trimmed.replace(/[\s().-]/g, '');
  if (normalized.startsWith('+')) {
    return /^\+[0-9]{8,15}$/.test(normalized);
  }

  return /^[0-9]{10,15}$/.test(normalized);
}
// specs/finance-dashboard-redesign.md rule 27 — immediate feedback on an annual revenue goal, mirroring
// server/src/utils/revenueGoals.js (the server stays the authority and re-validates on save).
// Returns the message to show under the field, or '' when the input is acceptable (empty = no goal).
export function revenueGoalInputError(value) {
  if (value == null || typeof value === 'number') return '';
  const text = String(value).replace(/[\s  ]/g, '').replace(',', '.');
  if (text === '') return '';
  if (/^-/.test(text) || /^0+(\.0*)?$/.test(text)) return "L'objectif doit être supérieur à 0 €. Laissez vide pour ne pas en fixer.";
  if (!/^\d+(\.\d+)?$/.test(text)) return 'Un montant en euros, sans lettres (ex. 85 000).';
  if (text.includes('.') && text.split('.')[1].length > 2) return 'Deux décimales au plus.';
  if (Number(text) > 10000000) return 'Montant trop élevé : 10 000 000 € au plus.';
  return '';
}

// specs/vat-optional-mode.md rule 36 — immediate feedback on the franchise threshold, mirroring
// server/src/utils/vatFranchise.js (the server re-validates). '' when acceptable (empty = no threshold).
export function vatThresholdInputError(value) {
  if (value == null || typeof value === 'number') return '';
  const text = String(value).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (text === '') return '';
  if (/^-/.test(text) || /^0+(\.0*)?$/.test(text)) return 'Montant supérieur à 0 €. Vide pour ne pas en fixer.';
  if (!/^\d+(\.\d+)?$/.test(text)) return 'Un montant en euros (ex. 12 500).';
  if (text.includes('.') && text.split('.')[1].length > 2) return 'Deux décimales au plus.';
  if (Number(text) > 10000000) return '10 000 000 € au plus.';
  return '';
}
