/**
 * Season plan — pure derivation of a year's season ranges from a tariff recipe
 * (specs/tariff-recipes/spec.md §3.3 rules 13-19, §3.7 rules 41-44).
 *
 * DATABASE-FREE AND CLOCK-FREE: same inputs → same output, always. The whole calendar is testable
 * in milliseconds without a fixture DB.
 *
 * Algorithm (per year):
 *   1. a per-day season array painted with `calendar.baseSeason`;
 *   2. periods repaint their span in declaration order (last write wins — rule 13), carrying their
 *      own minNights/changeover overrides;
 *   3. the `public_holiday_bridge` modifier raises each holiday block's nights by `amount` ranks,
 *      capped at the highest rank, skipping closed days (rules 15-17);
 *   4. contiguous runs of (same season, same override) become the date ranges — the per-day
 *      representation makes range splitting a consequence, not a special case, and overlapping
 *      ranges unrepresentable (rule 19).
 */

const { getFrenchPublicHolidays } = require('./frenchHolidays');

const DAY_MS = 86400000;

function iso(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function utc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseIso(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? utc(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ── Anchors (rule 14) ────────────────────────────────────────────────────────

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  let count = 0;
  const last = lastDayOfMonth(year, month);
  for (let day = 1; day <= last; day += 1) {
    const d = utc(year, month, day);
    if (d.getUTCDay() === weekday) {
      count += 1;
      if (count === occurrence) return d;
    }
  }
  return null;
}

// The last start `weekday` whose `nights`-night week still ends inside the month.
function lastFullWeekOfMonth(year, month, weekday, nights) {
  const last = lastDayOfMonth(year, month);
  for (let day = last; day >= 1; day -= 1) {
    const d = utc(year, month, day);
    if (d.getUTCDay() === weekday && day + nights - 1 <= last) return d;
  }
  return null;
}

// Resolve a period's span(s) for a year. `resolvedSpans` holds earlier periods' spans (for
// `between`). Returns [{ start: Date, end: Date }] — possibly two for a wrapping fixed_dates.
function resolveAnchor(period, year, resolvedSpans) {
  const a = period.anchor;
  if (a.type === 'fixed_dates') {
    const [fm, fd] = a.from.split('-').map(Number);
    const [tm, td] = a.to.split('-').map(Number);
    const from = utc(year, fm, fd);
    const to = utc(year, tm, td);
    if (from.getTime() <= to.getTime()) return [{ start: from, end: to }];
    // Wrapping window (e.g. 10-15 → 03-31): both ends of the SAME calendar year.
    return [
      { start: utc(year, 1, 1), end: to },
      { start: from, end: utc(year, 12, 31) },
    ];
  }
  if (a.type === 'nth_weekday_of_month') {
    const start = nthWeekdayOfMonth(year, a.month, a.weekday, a.occurrence);
    return start ? [{ start, end: addDays(start, period.nights - 1) }] : [];
  }
  if (a.type === 'last_full_week_of_month') {
    const start = lastFullWeekOfMonth(year, a.month, a.weekday, period.nights);
    return start ? [{ start, end: addDays(start, period.nights - 1) }] : [];
  }
  if (a.type === 'between') {
    const after = resolvedSpans[a.after];
    const before = resolvedSpans[a.before];
    if (!after || !before || !after.length || !before.length) return [];
    const start = addDays(after[after.length - 1].end, 1);
    const end = addDays(before[0].start, -1);
    return start.getTime() <= end.getTime() ? [{ start, end }] : []; // empty span → no range (edge case)
  }
  return [];
}

// ── Holiday blocks (rule 16) — the block of consecutive non-working days minus its last day ──────

const HOLIDAY_NIGHT_OFFSETS = {
  1: [-2, -1],       // Monday   → Sat, Sun
  2: [-3, -2, -1],   // Tuesday  → Sat, Sun, Mon (bridge)
  4: [0, 1, 2],      // Thursday → Thu, Fri, Sat (bridge)
  5: [0, 1],         // Friday   → Fri, Sat
};

function holidayNights(year) {
  const nights = [];
  for (const holiday of getFrenchPublicHolidays(year)) {
    const date = parseIso(holiday.date);
    const offsets = HOLIDAY_NIGHT_OFFSETS[date.getUTCDay()] || [];
    for (const offset of offsets) nights.push(addDays(date, offset));
  }
  return nights;
}

// ── Closures ─────────────────────────────────────────────────────────────────

/**
 * Materialize the recipe's recurring closures as absolute rows, one per start year in
 * [fromYear, toYear]. A wrapping window (from > to, e.g. 10-15 → 03-31) ends in the NEXT year.
 */
function materializeClosures(recipe, fromYear, toYear) {
  const rows = [];
  for (const closure of recipe.closures || []) {
    const [fm, fd] = closure.from.split('-').map(Number);
    const [tm, td] = closure.to.split('-').map(Number);
    const wraps = fm * 100 + fd > tm * 100 + td;
    for (let year = fromYear; year <= toYear; year += 1) {
      rows.push({
        label: closure.label,
        startDate: iso(utc(year, fm, fd)),
        endDate: iso(utc(wraps ? year + 1 : year, tm, td)),
      });
    }
  }
  return rows;
}

function isClosed(dateIso, closureRows) {
  return (closureRows || []).some((c) => dateIso >= c.startDate && dateIso <= c.endDate);
}

// ── The plan ─────────────────────────────────────────────────────────────────

const OVERRIDE_KEYS = ['minNights', 'changeoverArrival', 'changeoverDeparture'];

function overrideOfPeriod(period) {
  const override = {};
  if (Number.isInteger(period.minNights) && period.minNights >= 1) override.minNights = period.minNights;
  const arrival = period.changeover?.arrival;
  const departure = period.changeover?.departure;
  if (Number.isInteger(arrival)) override.changeoverArrival = arrival;
  if (Number.isInteger(departure)) override.changeoverDeparture = departure;
  return Object.keys(override).length ? override : null;
}

function overrideSignature(override) {
  return override ? OVERRIDE_KEYS.map((k) => override[k] ?? '').join('|') : '';
}

/**
 * One calendar year's ranges, keyed by season key. `closureRows` are absolute
 * `{ startDate, endDate }` rows (include the PREVIOUS winter's tail so a January holiday is
 * correctly skipped). Each range is `{ startDate, endDate }` + any per-period override keys.
 */
function buildYearPlan(recipe, year, closureRows = []) {
  const rankByKey = new Map(recipe.seasons.map((s) => [s.key, s.rank]));
  const keyByRank = new Map(recipe.seasons.map((s) => [s.rank, s.key]));
  const maxRank = Math.max(...recipe.seasons.map((s) => s.rank));

  // 1-2. Base + periods.
  const start = utc(year, 1, 1);
  const dayCount = Math.round((utc(year + 1, 1, 1).getTime() - start.getTime()) / DAY_MS);
  const days = new Array(dayCount).fill(null).map(() => ({ season: recipe.calendar.baseSeason, override: null }));
  const indexOf = (date) => Math.round((date.getTime() - start.getTime()) / DAY_MS);

  const resolvedSpans = {};
  for (const period of recipe.calendar.periods) {
    const spans = resolveAnchor(period, year, resolvedSpans);
    resolvedSpans[period.id] = spans;
    const override = overrideOfPeriod(period);
    for (const span of spans) {
      for (let t = Math.max(0, indexOf(span.start)); t <= Math.min(dayCount - 1, indexOf(span.end)); t += 1) {
        days[t] = { season: period.season, override };
      }
    }
  }

  // 3. Holiday raise (rules 15-17). Raised nights take the target season's own defaults (no override).
  for (const modifier of recipe.calendar.modifiers) {
    if (modifier.type !== 'public_holiday_bridge') continue;
    const amount = modifier.amount === undefined ? 1 : modifier.amount;
    for (const night of holidayNights(year)) {
      const t = indexOf(night);
      if (t < 0 || t >= dayCount) continue; // a block straddling 31 Dec belongs to each year's own run
      if (modifier.skipClosedDays && isClosed(iso(night), closureRows)) continue;
      const currentRank = rankByKey.get(days[t].season) || 1;
      const raisedKey = keyByRank.get(Math.min(maxRank, currentRank + amount));
      if (raisedKey && raisedKey !== days[t].season) days[t] = { season: raisedKey, override: null };
    }
  }

  // 4. Runs → ranges (rule 19).
  const plan = Object.fromEntries(recipe.seasons.map((s) => [s.key, []]));
  let runStart = 0;
  for (let t = 1; t <= dayCount; t += 1) {
    const prev = days[t - 1];
    const boundary = t === dayCount
      || days[t].season !== prev.season
      || overrideSignature(days[t].override) !== overrideSignature(prev.override);
    if (boundary) {
      const range = { startDate: iso(addDays(start, runStart)), endDate: iso(addDays(start, t - 1)) };
      if (prev.override) Object.assign(range, prev.override);
      plan[prev.season].push(range);
      runStart = t;
    }
  }
  return plan;
}

/**
 * The full horizon (recipe.horizonYears from `fromYear`), per season key. Ranges stay within their
 * own year (each year's generation owns its own days — no cross-year merging), so pruning a horizon
 * later is a plain endDate comparison.
 */
function buildHorizonPlan(recipe, fromYear, closureRows = []) {
  const plan = Object.fromEntries(recipe.seasons.map((s) => [s.key, []]));
  for (let year = fromYear; year < fromYear + recipe.horizonYears; year += 1) {
    const yearPlan = buildYearPlan(recipe, year, closureRows);
    for (const key of Object.keys(yearPlan)) plan[key].push(...yearPlan[key]);
  }
  return plan;
}

module.exports = { buildYearPlan, buildHorizonPlan, materializeClosures };
