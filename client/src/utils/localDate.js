// Calendar-day helpers on `YYYY-MM-DD` strings (specs/upcoming-reservations-cards.md rule 7).
// `toISOString()` is the UTC day: between midnight and 2 a.m. in Paris it still reads yesterday.

const pad = (n) => String(n).padStart(2, '0');

/** The browser's own calendar day. */
export function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` + n days, whatever the browser's time zone or a DST change in between. */
export function addIsoDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
