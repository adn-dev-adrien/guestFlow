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
