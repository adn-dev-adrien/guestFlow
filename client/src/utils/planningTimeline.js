/**
 * The planning timeline as drawn (specs/dashboard-planning-scroll.md rules 14, 15): the loaded windows'
 * days in order, the cards the plugins loaded for each, and the runs of days with nothing on them
 * folded into one line. Pure layout over what the server sent — which stays arrive where is the server's.
 */

const hasEntry = (entry) => Boolean(entry) && (!Array.isArray(entry) || entry.length > 0);

/** `{ [date]: { [contributionId]: entry } }` of what the plugins loaded, over every loaded window. */
export function pluginCardsByDate(windows) {
  const out = {};
  const place = (window, ownedOnly) => {
    const range = window.days.length ? [window.days[0].date, window.days[window.days.length - 1].date] : null;
    Object.entries(window.contrib || {}).forEach(([id, byDate]) => {
      Object.entries(byDate || {}).forEach(([date, entry]) => {
        const owned = range && date >= range[0] && date <= range[1];
        if (owned !== ownedOnly || !hasEntry(entry)) return;
        (out[date] = out[date] || {})[id] = entry;
      });
    });
  };
  // A window owns the dates of its range: its answer wins over another window's for the same date.
  windows.forEach((w) => place(w, false));
  windows.forEach((w) => place(w, true));
  return out;
}

/** A day carries no card at all: no stay, no breakfast, no option card, no plugin card. */
export function isEmptyDay(day, pluginCards) {
  return !day.arrivals.length
    && !day.departures.length
    && !(day.breakfast && day.breakfast.items && day.breakfast.items.length)
    && !(day.optionCards && day.optionCards.items && day.optionCards.items.length)
    && !(pluginCards && Object.keys(pluginCards).length);
}

// « lun. 2 nov. » + « dim. 8 nov. » → « du lun. 2 au dim. 8 nov. » (the shared month and year said once).
function runLabel(first, last) {
  if (first === last) return `${first}`;
  const [a, b] = [first, last].map((label) => {
    const [weekday, day, ...rest] = label.split(' ');
    return { weekday, day, rest: rest.join(' ') };
  });
  const from = a.rest === b.rest ? `${a.weekday} ${a.day}` : `${a.weekday} ${a.day} ${a.rest}`;
  return `du ${from} au ${b.weekday} ${b.day} ${b.rest}`;
}

/**
 * @param {{days: object[], contrib?: object}[]} windows loaded windows, earliest first
 * @returns {{ items: object[], pluginCards: object }} items are
 *   `{ kind: 'day', key, day, plugin }` or `{ kind: 'fold', key, from, to, label }`.
 *   A fold is keyed by its LAST date: content prepended to a run extends it at the start, so the key a
 *   scroll anchor holds does not change.
 */
export function buildTimeline(windows) {
  const pluginCards = pluginCardsByDate(windows);
  const items = [];
  let run = null;
  const closeRun = () => {
    if (!run) return;
    const first = run[0];
    const last = run[run.length - 1];
    items.push({
      kind: 'fold',
      key: `fold-${last.date}`,
      from: first.date,
      to: last.date,
      label: runLabel(first.shortLabel, last.shortLabel),
    });
    run = null;
  };
  windows.forEach((window) => window.days.forEach((day) => {
    const plugin = pluginCards[day.date] || {};
    if (!day.isToday && isEmptyDay(day, plugin)) {
      (run = run || []).push(day);
      return;
    }
    closeRun();
    items.push({ kind: 'day', key: `day-${day.date}`, day, plugin });
  }));
  closeRun();
  return { items, pluginCards };
}
