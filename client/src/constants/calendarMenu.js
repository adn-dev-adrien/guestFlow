// The Calendrier submenu entries of plugin modules (specs/plugins-phase-3c-hourly-resources.md rule
// 21, slot `calendar.menu`): `{ path, label }`, drawn above the properties' calendars. Each is visible
// through `canSeeRoute`, like every page — its plugin active, its roles allowed.
import PLUGIN_MODULES from '../plugins';

export const CALENDAR_ENTRIES = PLUGIN_MODULES.flatMap((mod) => ((mod.contributes && mod.contributes['calendar.menu']) || [])
  .map((entry) => ({ ...entry, pluginId: mod.id })));

export const CALENDAR_PATHS = CALENDAR_ENTRIES.map((entry) => entry.path);

/** True on the calendar or on one of the pages the submenu opens. */
export function isCalendarPath(pathname) {
  return String(pathname || '').startsWith('/calendar') || CALENDAR_PATHS.includes(pathname);
}
