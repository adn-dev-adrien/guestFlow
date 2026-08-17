/**
 * Slot algebra for an hourly-scheduled resource
 * (specs/hourly-resource-quantity-and-sas-scheduling.md §3.3 / §3.4).
 *
 * Answers one question: for each day of a stay, which start times can the guest actually take, and
 * when they can't — why. A slot is bookable only when it is inside the opening window, not in the
 * past, free of capacity conflicts (turnover included), and **thermally ready**.
 *
 * The thermal model exists because a nordic bath is not instantly usable: from cold it needs a
 * `heatUpMinutes` warm-up, and once heated it stays usable for `heatRetentionMinutes` after the end of
 * a use. So a slot shortly after another booking costs only the `turnoverMinutes` reset, while an
 * isolated slot needs the full warm-up. Both settings default to 0, which collapses this module back
 * to the pre-existing opening-window + capacity + turnover behaviour (§3.3 rule 16).
 *
 * Pure module: no DB, no `Date.now()` — the clock arrives as `notBefore`, so every classification is
 * reproducible under test.
 *
 * Times are handled as **absolute minutes** (days since the epoch × 1440 + minutes of the day) so a
 * use ending at 22:00 can still keep the resource warm for the next morning's 06:00 slot.
 */

const { toMinutes, eveningSupplement } = require('./resourceHourlyPricing');

const MINUTES_PER_DAY = 1440;

/** Days since the Unix epoch for a `YYYY-MM-DD` string. UTC-anchored, so DST never shifts it. */
function dayIndex(date) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Absolute minutes of `date` at `HH:MM`. */
function toAbsMinutes(date, time) {
  return dayIndex(date) * MINUTES_PER_DAY + toMinutes(time);
}

function minutesToTime(minutes) {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** `openDays` / `closedDays` are TEXT columns holding JSON; accept both the string and the array. */
function parseList(value, fallback) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** JS weekday of a `YYYY-MM-DD` (0 = Sunday), matching how `openDays` is stored. */
function weekdayOf(date) {
  const idx = dayIndex(date);
  if (!Number.isFinite(idx)) return NaN;
  // 1970-01-01 was a Thursday (4).
  return (((idx + 4) % 7) + 7) % 7;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
});

/** « sam. 12 sept. » — French label owned by the server (CLAUDE.md §6.0). */
function weekdayLabel(date) {
  const idx = dayIndex(date);
  if (!Number.isFinite(idx)) return String(date || '');
  return WEEKDAY_FORMATTER.format(new Date(idx * 86400000));
}

function normalizeResource(resource = {}) {
  const slotMinutes = Math.max(1, Number(resource.slotDuration) || 60);
  return {
    slotMinutes,
    // A per-hour resource always sells at least one whole slot.
    minDuration: Math.max(slotMinutes, Number(resource.minimumUsageMinutes) || 0),
    openMinutes: toMinutes(resource.openTime || '00:00'),
    closeMinutes: toMinutes(resource.closeTime || '23:59'),
    openDays: parseList(resource.openDays, [0, 1, 2, 3, 4, 5, 6]).map(Number),
    closedDays: parseList(resource.closedDays, []).map(String),
    turnover: Math.max(0, Number(resource.turnoverMinutes) || 0),
    capacity: Math.max(1, Number(resource.quantity) || 1),
    heatUp: Math.max(0, Number(resource.heatUpMinutes) || 0),
    retention: Math.max(0, Number(resource.heatRetentionMinutes) || 0),
  };
}

/** Occupancy rows → absolute ranges, ignoring anything malformed. */
function toRanges(occupancy) {
  return (Array.isArray(occupancy) ? occupancy : [])
    .map((item) => ({
      start: toAbsMinutes(item?.date, item?.start),
      end: toAbsMinutes(item?.date, item?.end),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * How many occupancy ranges collide with `[start, end)` once the turnover buffer is applied.
 * Mirrors the SQL predicate that `resourceBookingsModel.countConflicts` has always used, so the two
 * paths can never disagree about what « occupied » means.
 */
function countOverlaps(ranges, start, end, turnover) {
  return ranges.filter((r) => r.start < end + turnover && r.end + turnover > start).length;
}

/** End of the most recent use finishing at or before `start`, or null when there is none. */
function lastUseEndBefore(ranges, start) {
  let last = null;
  for (const range of ranges) {
    if (range.end <= start && (last === null || range.end > last)) last = range.end;
  }
  return last;
}

/**
 * Is the resource warm at `start`? True only when a previous use ended within the retention window.
 * `retention = 0` means « never retains », so every slot then takes the cold path.
 */
function isWarmAt(ranges, start, retention) {
  if (retention <= 0) return false;
  const lastEnd = lastUseEndBefore(ranges, start);
  return lastEnd !== null && (start - lastEnd) <= retention;
}

/**
 * Classify one candidate block. Returns `{ state, warm }` with
 * `state ∈ closed | past | taken | heating | free`, checked from the most immovable constraint down
 * so the reason shown to the operator is the most useful one.
 */
function classifyBlock({ norm, ranges, dayClosed, start, end, notBefore, notAfter = Infinity }) {
  const warm = isWarmAt(ranges, start, norm.retention);
  if (dayClosed) return { state: 'closed', warm };
  const dayStart = Math.floor(start / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  if (start < dayStart + norm.openMinutes || end > dayStart + norm.closeMinutes) {
    return { state: 'closed', warm };
  }
  // Past the check-out: the guests are gone, so the resource is not theirs to book — « fermé » for
  // them, whatever the resource's own hours say.
  if (end > notAfter) return { state: 'closed', warm };
  if (start < notBefore) return { state: 'past', warm };
  if (countOverlaps(ranges, start, end, norm.turnover) >= norm.capacity) return { state: 'taken', warm };
  // Thermal readiness: warm → the turnover (already enforced above) is the only wait;
  // cold → the resource has to be brought up to temperature first.
  if (!warm && start < notBefore + norm.heatUp) return { state: 'heating', warm };
  return { state: 'free', warm };
}

/**
 * Build the picker payload for every day of the stay.
 *
 * @param {object}   args
 * @param {object}   args.resource      row from `resources` (+ the two thermal columns)
 * @param {number}   args.dayRate       resolved per-property hourly rate (for the evening badge)
 * @param {string[]} args.stayDates     `YYYY-MM-DD` days on which the guest may place hours
 * @param {object[]} args.occupancy     `[{ date, start, end }]` — other people's bookings + sessions
 * @param {object[]} args.pending       blocks placed in the current SAS run, not saved yet
 * @param {number}   args.notBefore     absolute minutes: `max(now, check-in)`
 * @param {number}   args.notAfter      absolute minutes: the check-out
 * @returns {object[]} `[{ date, weekdayLabel, closed, occupancy, slots }]`
 */
function buildDays({ resource, dayRate = 0, stayDates = [], occupancy = [], pending = [], notBefore = -Infinity, notAfter = Infinity }) {
  const norm = normalizeResource(resource);
  // Pending blocks gate the slots exactly like a saved booking — they hold their slot and keep the
  // resource warm for the next one — but they are kept OUT of the displayed strip: that strip exists
  // to show the operator somebody ELSE's bookings, to place next to them. The operator's own
  // placements are already listed, and removable, under the grid.
  const ranges = toRanges([...occupancy, ...pending]);
  const visibleRanges = toRanges(occupancy);
  const supplementCfg = {
    dayRate,
    eveningRate: Number(resource?.hourlyEveningRate) || 0,
    eveningStart: resource?.hourlyEveningStart || null,
    slotMinutes: norm.slotMinutes,
  };

  return stayDates.map((date) => {
    const dayStart = dayIndex(date) * MINUTES_PER_DAY;
    const dayClosed = !norm.openDays.includes(weekdayOf(date)) || norm.closedDays.includes(date);
    const slots = [];

    for (
      let offset = norm.openMinutes;
      offset + norm.minDuration <= norm.closeMinutes;
      offset += norm.slotMinutes
    ) {
      const start = dayStart + offset;
      const end = start + norm.minDuration;
      const { state, warm } = classifyBlock({ norm, ranges, dayClosed, start, end, notBefore, notAfter });
      slots.push({
        start: minutesToTime(offset),
        end: minutesToTime(offset + norm.minDuration),
        state,
        warm,
        supplement: eveningSupplement(
          [{ start: minutesToTime(offset), end: minutesToTime(offset + norm.minDuration) }],
          supplementCfg,
        ),
      });
    }

    return {
      date,
      weekdayLabel: weekdayLabel(date),
      closed: dayClosed,
      // Times only — the SAS is run with the guest standing there, so no other client is named
      // (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 19).
      occupancy: visibleRanges
        .filter((r) => r.start >= dayStart && r.start < dayStart + MINUTES_PER_DAY)
        .map((r) => ({ start: minutesToTime(r.start), end: minutesToTime(r.end) })),
      slots,
    };
  });
}

/**
 * Authoritative check for one block the client wants to place. The picker only ever offers bookable
 * slots, but the payload it works from can be stale by the time it commits — so the commit re-runs
 * this and refuses rather than double-booking (§3.4 rule 27).
 *
 * @returns {{ ok: true } | { ok: false, reason: string }} reason ∈
 *   `duration | closed | past | taken | heating | budget`
 */
function validateBlock({ resource, block, occupancy = [], notBefore = -Infinity, notAfter = Infinity, remainingMinutes = Infinity }) {
  const norm = normalizeResource(resource);
  const ranges = toRanges(occupancy);
  const start = toAbsMinutes(block?.date, block?.start);
  const end = toAbsMinutes(block?.date, block?.end);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false, reason: 'duration' };
  const duration = end - start;
  if (duration < norm.minDuration) return { ok: false, reason: 'duration' };
  if (duration % norm.slotMinutes !== 0) return { ok: false, reason: 'duration' };
  if ((start % MINUTES_PER_DAY) % norm.slotMinutes !== norm.openMinutes % norm.slotMinutes) {
    return { ok: false, reason: 'duration' };
  }
  if (duration > remainingMinutes) return { ok: false, reason: 'budget' };

  const dayClosed = !norm.openDays.includes(weekdayOf(block.date)) || norm.closedDays.includes(String(block.date));
  const { state } = classifyBlock({ norm, ranges, dayClosed, start, end, notBefore, notAfter });
  return state === 'free' ? { ok: true } : { ok: false, reason: state };
}

module.exports = {
  buildDays,
  validateBlock,
  toAbsMinutes,
  minutesToTime,
  weekdayLabel,
  weekdayOf,
  dayIndex,
  MINUTES_PER_DAY,
};
