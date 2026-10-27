/**
 * Sessions of a stay that use a resource more times at once than it exists.
 *
 * - Within the stay (specs/plugins-phase-3c-hourly-resources.md rule 30): two baths placed on the same
 *   hour of a stay whose resource has a quantity of 1 are a double booking.
 * - Against everything else using the resource (specs/hourly-resource-quantity-and-sas-scheduling.md
 *   rule 28, « and vice versa »): an external booking or another stay's session on that slot counts
 *   too, turnover-aware, as it already does when an external booking is created over a session.
 *
 * The fiche save is refused, as the arrival SAS already refuses it (`SLOT_CONFLICT`).
 *
 * Pure: the caller gives the payload's resources, each resource's quantity and, optionally, what else
 * occupies a resource on a date.
 */

const { formatTimeShort, formatDateLong } = require('./dateFr');

const toMinutes = (time) => {
  const [h, m] = String(formatTimeShort(time) || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

const sessionKey = (date, start, end) => `${date}|${formatTimeShort(start)}|${formatTimeShort(end)}`;

/**
 * @param {Array<{ resourceId: number, sessions?: Array<{ date, start, end }> }>} resources
 * @param {(resourceId: number) => number} capacityOf  the resource's quantity (≥ 1)
 * @param {object} [elsewhere]
 * @param {(resourceId: number, date: string) => Array<{ start, end }>} [elsewhere.occupiedOn]
 *   what else uses the resource that day (external bookings, other stays' sessions)
 * @param {(resourceId: number) => number} [elsewhere.turnoverOf]  minutes kept free between two uses
 * @param {(resourceId: number) => Set<string>} [elsewhere.storedOf]  the stay's sessions already saved
 *   (`date|start|end`): an unchanged session is not re-judged against the others, so a fiche that
 *   already carried an overlap can still be saved for anything else
 * @returns {{ resourceId, date, start, end, elsewhere?: true } | null} the first session that exceeds
 *   the capacity, in date and start order
 */
function firstSessionConflict(resources, capacityOf, { occupiedOn = () => [], turnoverOf = () => 0, storedOf = () => new Set() } = {}) {
  for (const line of Array.isArray(resources) ? resources : []) {
    const sessions = (Array.isArray(line && line.sessions) ? line.sessions : [])
      .map((s) => ({ date: String(s && s.date || '').slice(0, 10), start: toMinutes(s && s.start), end: toMinutes(s && s.end), raw: s }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.end > s.start)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    if (sessions.length === 0) continue;
    const resourceId = Number(line.resourceId);
    const capacity = Math.max(1, Number(capacityOf(resourceId)) || 1);
    const buffer = Math.max(0, Number(turnoverOf(resourceId)) || 0);
    const stored = storedOf(resourceId) || new Set();
    const othersByDate = new Map();
    const others = (date) => {
      if (!othersByDate.has(date)) {
        othersByDate.set(date, (occupiedOn(resourceId, date) || [])
          .map((o) => ({ start: toMinutes(o.start), end: toMinutes(o.end) }))
          .filter((o) => o.end > o.start));
      }
      return othersByDate.get(date);
    };
    for (let i = 0; i < sessions.length; i += 1) {
      const current = sessions[i];
      const own = sessions.slice(0, i)
        .filter((s) => s.date === current.date && s.start < current.end && current.start < s.end).length;
      const judged = !stored.has(sessionKey(current.date, current.raw.start, current.raw.end));
      const outside = judged
        ? others(current.date).filter((o) => o.start < current.end + buffer && o.end + buffer > current.start).length
        : 0;
      if (own + outside >= capacity) {
        return {
          resourceId,
          date: current.date,
          start: formatTimeShort(current.raw.start),
          end: formatTimeShort(current.raw.end),
          ...(own < capacity ? { elsewhere: true } : {}),
        };
      }
    }
  }
  return null;
}

// The 409 body of a refused save.
function conflictError(conflict) {
  if (conflict.elsewhere) {
    return {
      error: `Créneau déjà occupé le ${formatDateLong(conflict.date)} à ${conflict.start} : la ressource est réservée par ailleurs.`,
      code: 'RESOURCE_SLOT_TAKEN',
      conflict,
    };
  }
  return {
    error: `Séances qui se chevauchent le ${formatDateLong(conflict.date)} à ${conflict.start}.`,
    code: 'SESSIONS_OVERLAP',
    conflict,
  };
}

module.exports = { firstSessionConflict, conflictError, sessionKey };
