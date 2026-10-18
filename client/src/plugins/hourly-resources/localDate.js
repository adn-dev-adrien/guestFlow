// The browser's calendar day as `YYYY-MM-DD` — not `toISOString()`, the UTC day, which still reads
// yesterday between midnight and 2 a.m. in Paris (specs/upcoming-reservations-cards.md rule 7).
const pad = (n) => String(n).padStart(2, '0');

export function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
