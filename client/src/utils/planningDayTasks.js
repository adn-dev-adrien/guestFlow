/**
 * The day's tickable tasks on the Planning — specs/planning-day-task-count.md.
 *
 * The day header chip used to count arrivals only, so a day made of departures and a bain nordique to
 * prepare read « 0/0 » — « rien à faire » — while the operator had three things to tick, and could
 * never turn green. This is the single place that decides what the counter counts:
 *
 *   - an arrival    → done when `checkInReady` (the card's « Prêt » checkbox);
 *   - a departure   → done when `checkOutDone` (« Effectué »);
 *   - a plugin's day cards → what its `planning.days` contribution's `countTasks(entry)` returns,
 *     `{ done, total }` (specs/plugins-phase-2-hosts.md rule 7). The laundry card counts none; the
 *     hourly resources count their ignition and session cards (specs/plugins-phase-3c-hourly-resources.md
 *     rule 22).
 *
 * Pure: it counts the very items the page is rendering, so the chip can never disagree with the cards
 * below it.
 */

const len = (list) => (Array.isArray(list) ? list.length : 0);
const countDone = (list, predicate) => (Array.isArray(list) ? list.filter(predicate).length : 0);

const sumOf = (list, key) => (Array.isArray(list) ? list.reduce((n, t) => n + (Number(t && t[key]) || 0), 0) : 0);

export function countDayTasks({ arrivals, departures, contributed } = {}) {
  const total = len(arrivals) + len(departures) + sumOf(contributed, 'total');
  const done = countDone(arrivals, (r) => Boolean(r.checkInReady))
    + countDone(departures, (r) => Boolean(r.checkOutDone))
    + sumOf(contributed, 'done');
  return { done, total, allDone: total > 0 && done === total };
}

export default countDayTasks;
