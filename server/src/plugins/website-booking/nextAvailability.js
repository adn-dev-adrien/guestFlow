/**
 * The first night a lodging can still be booked, from a given day (specs/public-api.md
 * `GET /properties/:id/availability`, `nextAvailableDate`; specs/wp-booking-widget-redesign.md
 * rule 30).
 *
 * The site opens its calendar on two months. When both are closed — a lodging that opens in April,
 * visited in October — the visitor reads « fully booked » and leaves, unless something says when
 * the first free night is. The server answers it: it is the only party that sees beyond the window
 * the site asked for.
 *
 * Pure: the blocked nights of the requested window come in, and `loadBlocked(from, to)` is called
 * only when the window holds no free night, to look up to `horizonDays` further. A night is free
 * when it is not in the blocked set; past nights never count.
 */

const DEFAULT_HORIZON_DAYS = 365;

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function firstFree(start, end, blocked) {
  for (let day = start; day < end; day = addDays(day, 1)) {
    if (!blocked.has(day)) return day;
  }
  return null;
}

/**
 * @param {object} p
 * @param {string} p.from - first day of the requested window (ISO)
 * @param {string} p.to - end of the requested window, exclusive (ISO)
 * @param {string} p.todayIso - today in the lodgings' timezone (ISO)
 * @param {string[]} p.blockedDates - blocked nights of [from, to)
 * @param {(from: string, to: string) => string[]} p.loadBlocked - blocked nights of another window
 * @param {number} [p.horizonDays=365] - how far past the start to look
 * @returns {string|null} the first free night on or after max(from, today), or null within the horizon
 */
function findNextAvailableDate({ from, to, todayIso, blockedDates, loadBlocked, horizonDays = DEFAULT_HORIZON_DAYS }) {
  const start = from > todayIso ? from : todayIso;
  const horizon = addDays(start, horizonDays);
  if (start < to) {
    const inWindow = firstFree(start, to < horizon ? to : horizon, new Set(blockedDates || []));
    if (inWindow) return inWindow;
  }
  const beyond = start > to ? start : to;
  if (beyond >= horizon) return null;
  return firstFree(beyond, horizon, new Set(loadBlocked(beyond, horizon) || []));
}

module.exports = { findNextAvailableDate, DEFAULT_HORIZON_DAYS };
