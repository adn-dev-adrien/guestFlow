/**
 * The day's tickable tasks on the Planning — specs/planning-day-task-count.md.
 *
 * The day header chip used to count arrivals only, so a day made of departures and a bain nordique to
 * prepare read « 0/0 » — « rien à faire » — while the operator had three things to tick, and could
 * never turn green. This is the single place that decides what the counter counts:
 *
 *   - an arrival    → done when `checkInReady` (the card's « Prêt » checkbox);
 *   - a departure   → done when `checkOutDone` (« Effectué »);
 *   - a resource session card (bain nordique & co) → done when its `done` flag is set.
 *
 * Pure: it counts the very items the page is rendering, so the chip can never disagree with the cards
 * below it.
 */

const len = (list) => (Array.isArray(list) ? list.length : 0);
const countDone = (list, predicate) => (Array.isArray(list) ? list.filter(predicate).length : 0);

export function countDayTasks({ arrivals, departures, resourceCards } = {}) {
  const total = len(arrivals) + len(departures) + len(resourceCards);
  const done = countDone(arrivals, (r) => Boolean(r.checkInReady))
    + countDone(departures, (r) => Boolean(r.checkOutDone))
    + countDone(resourceCards, (c) => Boolean(c.done));
  return { done, total, allDone: total > 0 && done === total };
}

export default countDayTasks;
