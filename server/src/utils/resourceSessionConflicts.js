/**
 * Sessions of one stay that use a resource more times at once than it exists
 * (specs/plugins-phase-3c-hourly-resources.md rule 30). Two baths placed on the same hour of a stay
 * whose resource has a quantity of 1 are a double booking: the fiche save is refused, as the arrival
 * SAS already refuses it (`SLOT_CONFLICT`).
 *
 * Pure: the caller gives the payload's resources and each resource's quantity.
 */

const { formatTimeShort, formatDateLong } = require('./dateFr');

const toMinutes = (time) => {
  const [h, m] = String(formatTimeShort(time) || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

/**
 * @param {Array<{ resourceId: number, sessions?: Array<{ date, start, end }> }>} resources
 * @param {(resourceId: number) => number} capacityOf  the resource's quantity (≥ 1)
 * @returns {{ resourceId: number, date: string, start: string, end: string } | null} the first session
 *   that exceeds the capacity, in date and start order
 */
function firstSessionConflict(resources, capacityOf) {
  for (const line of Array.isArray(resources) ? resources : []) {
    const sessions = (Array.isArray(line && line.sessions) ? line.sessions : [])
      .map((s) => ({ date: String(s && s.date || '').slice(0, 10), start: toMinutes(s && s.start), end: toMinutes(s && s.end), raw: s }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.end > s.start)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    if (sessions.length < 2) continue;
    const capacity = Math.max(1, Number(capacityOf(Number(line.resourceId))) || 1);
    for (let i = 0; i < sessions.length; i += 1) {
      const current = sessions[i];
      const concurrent = sessions.slice(0, i)
        .filter((s) => s.date === current.date && s.start < current.end && current.start < s.end).length;
      if (concurrent >= capacity) {
        return {
          resourceId: Number(line.resourceId),
          date: current.date,
          start: formatTimeShort(current.raw.start),
          end: formatTimeShort(current.raw.end),
        };
      }
    }
  }
  return null;
}

// The 409 body of a refused save.
function conflictError(conflict) {
  return {
    error: `Séances qui se chevauchent le ${formatDateLong(conflict.date)} à ${conflict.start}.`,
    code: 'SESSIONS_OVERLAP',
    conflict,
  };
}

module.exports = { firstSessionConflict, conflictError };
