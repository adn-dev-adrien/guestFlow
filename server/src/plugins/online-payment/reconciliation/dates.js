/**
 * Calendar day of a stored date (specs/qonto-bank-reconciliation.md rule 40).
 *
 * Qonto settles credits at an instant in UTC (`2026-10-22T22:30:00.000Z`); the operator lives on
 * Paris time, where that credit is the 23rd. Instants are read in Europe/Paris, plain `YYYY-MM-DD`
 * values (reservation dates) pass through untouched.
 */
const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/;

function day(value) {
  const text = String(value == null ? '' : value);
  if (INSTANT.test(text)) {
    const at = new Date(text);
    if (!Number.isNaN(at.getTime())) return PARIS.format(at);
  }
  const s = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

module.exports = { day };
