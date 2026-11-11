/**
 * A SQLite `datetime('now')` value — UTC, no zone — as the operator reads it: « 18/10/2026 02:11 »,
 * Europe/Paris (specs/email-history-rolling-window.md rule 8). Pure.
 */

const DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

function parisDateTimeLabel(value) {
  if (!value) return '';
  const raw = String(value).trim();
  // A value without a zone is UTC (SQLite); one with a zone or a `Z` is taken as it is.
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw.replace(' ', 'T') : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return raw;
  return `${DATE.format(date)} ${TIME.format(date)}`;
}

module.exports = { parisDateTimeLabel };
