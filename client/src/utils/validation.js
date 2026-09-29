export function isValidEmail(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
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
