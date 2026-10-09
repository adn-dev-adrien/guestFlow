/**
 * Bounded date-range validation for the reception-reachable planning queries.
 *
 * DATA-1 (2026-10-08 infrastructure audit): several admin/reception endpoints accepted an
 * arbitrary `from`/`to` span and iterated it. `GET /planning/laundry` in particular walks every
 * date of the window and runs ~10 prepared queries per date, so `?from=0001-01-01&to=9999-12-31`
 * (~521 000 dates) is a single-threaded CPU/SQL denial of service reachable by the low-privilege
 * reception role.
 *
 * The ceiling is deliberately generous — 750 days (just over two years) — so it can never reject a
 * legitimate planning or laundry window (a gîte's booking horizon is well under that), while still
 * stopping a pathological multi-millennia span cold. Rejections return a stable error code, never a
 * stack trace.
 */

const MAX_PLANNING_RANGE_DAYS = 750;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

// Whole days between two YYYY-MM-DD strings, computed in UTC so DST never shifts the count.
function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * Validate a finalized `from`/`to` window. Returns `null` when the range is acceptable, or
 * `{ status, error }` to send as-is. `from`/`to` must already be resolved (no undefined `to`).
 */
function checkPlanningRange(from, to, maxDays = MAX_PLANNING_RANGE_DAYS) {
  if (!isIsoDate(from) || !isIsoDate(to)) return { status: 400, error: 'INVALID_DATE_RANGE' };
  if (from > to) return { status: 400, error: 'INVALID_DATE_RANGE' };
  if (daysBetween(from, to) > maxDays) return { status: 400, error: 'DATE_RANGE_TOO_WIDE' };
  return null;
}

module.exports = { MAX_PLANNING_RANGE_DAYS, isIsoDate, daysBetween, checkPlanningRange };
