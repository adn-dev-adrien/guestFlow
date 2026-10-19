/**
 * The linen shortage as a subject of the home's « À traiter » (specs/shell-and-home-day-first.md
 * rules 6, 9). Urgent: a stay would start without its sheets.
 */
const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`));

function summarize(payload) {
  const types = Array.isArray(payload && payload.shortagesByType) ? payload.shortagesByType : [];
  if (!types.length) return null;
  const first = types.map((entry) => entry.firstShortageDate).filter(Boolean).sort()[0];
  return {
    count: types.length,
    title: 'Stock de linge insuffisant',
    detail: `${types.length} ${types.length > 1 ? 'types en rupture' : 'type en rupture'}${first ? ` à partir du ${longDate(first)}` : ''}`,
    severity: 'urgent',
  };
}

module.exports = { summarize };
