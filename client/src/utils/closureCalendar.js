/**
 * Client-side helpers for establishment closures on the calendar.
 */

export function expandClosuresToDates(closures) {
  const set = new Set();
  for (const c of closures || []) {
    if (!c || !c.startDate || !c.endDate) continue;
    let cursor = String(c.startDate);
    const end = String(c.endDate);
    while (cursor < end) {
      set.add(cursor);
      const next = new Date(`${cursor}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
  }
  return Array.from(set).sort();
}

export function getClosureForDate(dateStr, closures, selectedPropertyId) {
  if (!dateStr || !Array.isArray(closures)) return null;
  const pid = selectedPropertyId != null ? Number(selectedPropertyId) : null;
  return closures.find((c) => {
    const matchesProperty = c.propertyId == null || (pid != null && Number(c.propertyId) === pid);
    return matchesProperty && String(c.startDate) <= dateStr && dateStr < String(c.endDate);
  }) || null;
}

/**
 * How a closure touches a day on a logement's calendar (specs/calendar-property-parity.md rule 12): the
 * closure's `startDate` is closed from the middle of the day, its reopening day (`endDate`) until the
 * middle of the day, every day between all day. A day two closures meet on is closed all day.
 * Returns `{ closure, part }` where part is 'full' | 'start' | 'end', or null when the day is open.
 */
export function getClosureDayParts(dateStr, closures, selectedPropertyId) {
  if (!dateStr || !Array.isArray(closures)) return null;
  const pid = selectedPropertyId != null ? Number(selectedPropertyId) : null;
  const touching = closures.filter((c) => (c.propertyId == null || (pid != null && Number(c.propertyId) === pid))
    && String(c.startDate) <= dateStr && dateStr <= String(c.endDate));
  if (touching.length === 0) return null;
  const full = touching.find((c) => String(c.startDate) < dateStr && dateStr < String(c.endDate));
  if (full) return { closure: full, part: 'full' };
  const starting = touching.find((c) => String(c.startDate) === dateStr);
  const ending = touching.find((c) => String(c.endDate) === dateStr);
  if (starting && ending) return { closure: starting, part: 'full' };
  return starting ? { closure: starting, part: 'start' } : { closure: ending, part: 'end' };
}
