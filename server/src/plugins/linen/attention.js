/**
 * The linen shortage as a subject of the home's « À traiter » (specs/shell-and-home-day-first.md
 * rules 6, 9). Urgent: a stay would start without its sheets.
 */
// « 21 octobre », and « 21 octobre 2027 » when the date is not in the current year.
const longDate = (iso, now) => new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  ...(iso.slice(0, 4) !== String(now.getFullYear()) ? { year: 'numeric' } : {}),
  timeZone: 'UTC',
}).format(new Date(`${iso}T00:00:00Z`));

function summarize(payload, now = new Date()) {
  const types = Array.isArray(payload && payload.shortagesByType) ? payload.shortagesByType : [];
  if (!types.length) return null;
  const first = types.map((entry) => entry.firstShortageDate).filter(Boolean).sort()[0];
  return {
    count: types.length,
    title: 'Stock de linge insuffisant',
    detail: `${types.length} ${types.length > 1 ? 'types en rupture' : 'type en rupture'}${first ? ` à partir du ${longDate(first, now)}` : ''}`,
    severity: 'urgent',
  };
}

module.exports = { summarize };
