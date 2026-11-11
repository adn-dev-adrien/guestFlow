// The zone dots the calendars draw on a school-holiday day (specs/school-holidays.md;
// specs/plugins-phase-1-sdk.md rule 13, slot `calendar.dayMarkers`).
import { api } from '../sdk';
import { getSchoolHolidayInfo } from './holidayInfo';
import { ZONE_COLORS } from './zoneColors';

/** Loads the periods once and returns `markersFor(dateStr)` → [{ key, color, title }]. */
export async function load() {
  const res = await api.getSchoolHolidays();
  const periods = Array.isArray(res?.periods) ? res.periods : (Array.isArray(res) ? res : []);
  return (dateStr) => {
    const info = getSchoolHolidayInfo(dateStr, periods);
    if (!info) return [];
    return info.zones.map((z) => ({ key: `zone-${z}`, color: ZONE_COLORS[z], title: `${info.label} — zone ${z}` }));
  };
}
