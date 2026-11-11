// Checks if dateStr falls within a school holiday period from dynamic (server-fetched) data.
// schoolHolidays: array of { zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end, label }
// French public holidays are now computed server-side (GET /api/public-holidays).
export function getSchoolHolidayInfo(dateStr, schoolHolidays) {
  for (const h of schoolHolidays) {
    const zones = [];
    if (h.zoneA_start && h.zoneA_end && dateStr >= h.zoneA_start && dateStr <= h.zoneA_end) zones.push('A');
    if (h.zoneB_start && h.zoneB_end && dateStr >= h.zoneB_start && dateStr <= h.zoneB_end) zones.push('B');
    if (h.zoneC_start && h.zoneC_end && dateStr >= h.zoneC_start && dateStr <= h.zoneC_end) zones.push('C');
    if (zones.length > 0) return { zones, label: h.label };
  }
  return null;
}
