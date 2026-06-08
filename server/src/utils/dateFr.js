/**
 * French-locale date + time formatters for email templates
 * (specs/email-automation.md §3 rule 5 + §4.4).
 *
 * Pure: ISO strings in, formatted strings out. Empty / malformed input → empty string
 * (the renderer is fail-safe; an unknown date in a template should never break the send).
 */

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

// `2026-06-15` → `15 juin 2026`. Truncates the time portion if present.
function formatDateLong(isoDate) {
  if (!isoDate) return '';
  const [datePart] = String(isoDate).split('T');
  const [y, m, d] = datePart.split('-');
  const monthIdx = Number(m) - 1;
  const dayNum = Number(d);
  const yearNum = Number(y);
  if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx > 11) return '';
  if (!Number.isInteger(dayNum) || dayNum <= 0 || dayNum > 31) return '';
  if (!Number.isInteger(yearNum) || yearNum < 1000) return '';
  return `${dayNum} ${FR_MONTHS[monthIdx]} ${yearNum}`;
}

// `15:00:00` or `15:00` → `15:00`. Empty / malformed → empty string.
function formatTimeShort(value) {
  if (!value) return '';
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return '';
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

module.exports = {
  formatDateLong,
  formatTimeShort,
  FR_MONTHS,
};
