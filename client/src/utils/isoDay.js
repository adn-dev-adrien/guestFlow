/**
 * Calendar days as 'YYYY-MM-DD' strings, independent of the browser's time zone
 * (specs/ds-sweep-planning.md rule 28). `addIsoDays` counts days on the calendar, in UTC, so a
 * daylight-saving change never shifts the result; `localIsoToday` is the browser's own date, the
 * fallback while the server's date is not known.
 */

export function addIsoDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether `value` is a `YYYY-MM-DD` string naming a day of the calendar (UTC round-trip), the server's
 * `utils/stayDates.isRealIsoDay`: a 5-digit year or 30 February is not one; a year padded to four digits is.
 */
export function isRealIsoDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function localIsoToday(now = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
