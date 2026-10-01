/**
 * ISO-date day arithmetic (`YYYY-MM-DD` in, `YYYY-MM-DD` out). Each date is read as UTC midnight so
 * a day stays 24 h across the CET/CEST changes, whatever the server's time zone.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso, n) {
  if (!ISO_DATE_RE.test(String(iso || ''))) throw new Error(`INVALID_ISO_DATE:${iso}`);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}

module.exports = { addDays };
