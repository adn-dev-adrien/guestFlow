/**
 * Ready-to-render stay of a devis row (specs/devis-list-mobile-card.md rule 5): the number of nights
 * and a French range label where the year is printed once at the end, and again on both ends only when
 * the stay straddles two years — « 10 → 13 mai 2027 · 3 nuits », « 30 déc. 2026 → 2 janv. 2027 · 3 nuits ».
 */

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function parseIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toUtcDay({ year, month, day }) {
  return Date.UTC(year, month - 1, day) / 86400000;
}

function stayNights(startDate, endDate) {
  const start = parseIso(startDate);
  const end = parseIso(endDate);
  if (!start || !end) return null;
  return Math.max(0, Math.round(toUtcDay(end) - toUtcDay(start)));
}

function stayLabel(startDate, endDate) {
  const start = parseIso(startDate);
  const end = parseIso(endDate);
  if (!start && !end) return null;
  const part = (date, withMonth, withYear) => [date.day, withMonth ? MONTHS[date.month - 1] : null, withYear ? date.year : null]
    .filter((piece) => piece !== null).join(' ');
  if (!start || !end) return part(start || end, true, true);

  let range;
  if (start.year !== end.year) range = `${part(start, true, true)} → ${part(end, true, true)}`;
  else if (start.month !== end.month) range = `${part(start, true, false)} → ${part(end, true, true)}`;
  else range = `${part(start, false, false)} → ${part(end, true, true)}`;

  const nights = stayNights(startDate, endDate);
  return nights === null ? range : `${range} · ${nights} nuit${nights > 1 ? 's' : ''}`;
}

module.exports = { stayNights, stayLabel };
