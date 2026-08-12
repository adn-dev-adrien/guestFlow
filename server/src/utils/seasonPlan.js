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

// One entry per holiday that actually forms a block, with its nights. The block LENGTH is the
// commercial length of the « pont » and drives the minimum-nights constraint (spec rule 16bis).
function holidayBlocks(year) {
  const blocks = [];
  for (const holiday of getFrenchPublicHolidays(year)) {
    const date = parseIso(holiday.date);
    const offsets = HOLIDAY_NIGHT_OFFSETS[date.getUTCDay()] || [];
    if (!offsets.length) continue;
    blocks.push({ label: holiday.label, nights: offsets.map((offset) => addDays(date, offset)) });
  }
  return blocks;
}

// `minNights: "block"` → the block's own length (2 nights for a Friday/Monday holiday, 3 for a
// Tuesday/Thursday bridge); an integer → that value; absent → no minimum imposed.
function resolveModifierMinNights(modifier, blockLength) {
  if (modifier.minNights === 'block') return blockLength;
  return Number.isInteger(modifier.minNights) && modifier.minNights >= 1 ? modifier.minNights : 0;
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

// `eventKey` rides along so an event's nights form their OWN range instead of merging into the
// neighbouring high-season one — that separation is what lets the seasons table name the event
// (spec §3.3 rule 15bis). `eventLabel` follows it for display and never affects the signature.
const OVERRIDE_KEYS = ['minNights', 'maxNights', 'changeoverArrival', 'changeoverDeparture', 'eventKey'];

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

  // 3. Holiday raise (rules 15-17 + 16bis). A holiday block goes up one rank AND carries the block's
  //    minimum nights, so a « pont » can never be sold as a single isolated night.
  for (const modifier of recipe.calendar.modifiers) {
    if (modifier.type !== 'public_holiday_bridge') continue;
    const amount = modifier.amount === undefined ? 1 : modifier.amount;
    const touched = new Set();
    for (const block of holidayBlocks(year)) {
      const blockMinNights = resolveModifierMinNights(modifier, block.nights.length);
      for (const night of block.nights) {
        const t = indexOf(night);
        if (t < 0 || t >= dayCount) continue; // a block straddling 31 Dec belongs to each year's own run
        if (modifier.skipClosedDays && isClosed(iso(night), closureRows)) continue;
        const current = days[t];
        const currentRank = rankByKey.get(current.season) || 1;
        // Two overlapping blocks must not raise the same night twice.
        const raisedKey = touched.has(t)
          ? current.season
          : (keyByRank.get(Math.min(maxRank, currentRank + amount)) || current.season);
        touched.add(t);
        // A raised night leaves its period, so it drops that period's overrides; a night already at
        // the top rank keeps them. The holiday minimum wins whenever it is the stronger constraint,
        // which also resolves two overlapping blocks to the longer « pont ».
        const kept = raisedKey === current.season ? (current.override || {}) : {};
        const minNights = Math.max(blockMinNights, Number(kept.minNights || 0));
        const override = minNights > 0
          ? { ...kept, minNights }
          : (Object.keys(kept).length ? kept : null);
        days[t] = { season: raisedKey, override };
      }
    }
  }

  // 3bis. Events (spec/tariff-events-and-extra-guest-tiers §3.2 rules 8-13). Declared per year, not
  //    derived — L'Ardéchoise has no calendar rule to derive from. Applied AFTER the holiday raise
  //    ON PURPOSE: it is the only place in the model where a minimum stay goes DOWN, so « 1 night
  //    allowed » holds even on a week a public-holiday bridge would otherwise lock to 3 nights.
  for (const event of recipe.calendar.events || []) {
    const window = event.dates ? event.dates[String(year)] : null;
    // Rule 12: a year with no declared dates is not invented. Those nights keep what the base
    // season and the periods gave them, and the gap is reported by `missingEventYears`.
    if (!window || !window.from || !window.to) continue;
    const override = { eventKey: event.key, eventLabel: event.label };
    if (Number.isInteger(event.minNights) && event.minNights >= 1) override.minNights = event.minNights;
    if (Number.isInteger(event.maxNights) && event.maxNights >= 1) override.maxNights = event.maxNights;
    const fromIndex = indexOf(parseIso(window.from));
    const toIndex = indexOf(parseIso(window.to));
    for (let t = Math.max(0, fromIndex); t <= Math.min(dayCount - 1, toIndex); t += 1) {
      // Rule 13: an event never reopens a closure.
      if (isClosed(iso(addDays(start, t)), closureRows)) continue;
      days[t] = { season: event.season, override };
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

/**
 * Every (event, year) pair in [fromYear, toYear] with no declared dates — spec §3.3 rules 16-17.
 * Pure derivation over the recipe, so the property card, the recipe endpoint and the Dashboard
 * alert all read the same answer and cannot disagree about what is missing.
 *
 * This is the safety net behind the scheduled watch (rule 17bis): the schedule finds the dates
 * early, this catches the year it did not.
 */
function missingEventYears(recipe, fromYear, toYear) {
  const events = (recipe && recipe.calendar && recipe.calendar.events) || [];
  const out = [];
  for (const event of events) {
    for (let year = fromYear; year <= toYear; year += 1) {
      const window = event.dates ? event.dates[String(year)] : null;
      if (window && window.from && window.to) continue;
      out.push({
        key: event.key, label: event.label, year, sourceUrl: event.sourceUrl || null,
      });
    }
  }
  return out;
}

module.exports = {
  buildYearPlan, buildHorizonPlan, materializeClosures, missingEventYears,
};
