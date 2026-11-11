// Pure helpers for grouping school-holiday periods by French school year.
// School year S spans Sept 1 of year Y → Aug 31 of year Y+1.

export function getSchoolYearOf(dateStr) {
  if (!dateStr) return null;
  const [yearStr, monthStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Sep-Dec → school year starts THIS year; Jan-Aug → started PREVIOUS year.
  const yStart = month >= 9 ? year : year - 1;
  const yEnd = yStart + 1;
  return {
    yStart,
    yEnd,
    start: `${yStart}-09-01`,
    end: `${yEnd}-08-31`,
    label: `Année scolaire ${yStart}-${yEnd}`,
  };
}

function earliestStart(period) {
  return [period.zoneA_start, period.zoneB_start, period.zoneC_start]
    .filter(Boolean)
    .sort()[0];
}

export function groupPeriodsBySchoolYear(periods) {
  const groups = new Map();
  for (const period of periods || []) {
    const anchor = earliestStart(period);
    if (!anchor) continue;
    const sy = getSchoolYearOf(anchor);
    if (!sy) continue;
    const key = sy.start;
    if (!groups.has(key)) groups.set(key, { schoolYear: sy, periods: [] });
    groups.get(key).periods.push(period);
  }
  return [...groups.values()].sort((a, b) => a.schoolYear.start.localeCompare(b.schoolYear.start));
}
