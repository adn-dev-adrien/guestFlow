/**
 * School holidays validation — pure helpers, French errors.
 *
 * Two validators:
 *   - validatePeriod: a single school-holidays row (label + 3 optional zone date-pairs).
 *   - validateSyncSettings: the user-editable sync config (interval + horizon).
 */

const ZONE_KEYS = ['A', 'B', 'C'];

function validatePeriod(period = {}) {
  const label = String(period.label || '').trim();
  if (!label) {
    return 'Le libellé est obligatoire.';
  }

  let configuredZones = 0;
  for (const zone of ZONE_KEYS) {
    const start = period[`zone${zone}_start`] || '';
    const end = period[`zone${zone}_end`] || '';
    const hasStart = Boolean(start);
    const hasEnd = Boolean(end);
    if (hasStart !== hasEnd) {
      return `Zone ${zone} : la date de début et la date de fin doivent être renseignées ensemble.`;
    }
    if (hasStart && hasEnd) {
      configuredZones += 1;
      if (start > end) {
        return `Zone ${zone} : la date de fin doit être postérieure ou égale à la date de début.`;
      }
    }
  }

  if (configuredZones === 0) {
    return 'Vous devez configurer au moins une zone (A, B ou C).';
  }

  return null;
}

module.exports = { validatePeriod, ZONE_KEYS };
