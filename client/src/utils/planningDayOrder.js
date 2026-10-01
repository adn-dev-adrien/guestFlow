/**
 * planningDayOrder — order a planning day's renderable cards by time.
 *
 * Pure presentational ordering (specs/planning-chronological-day-ordering.md): the Planning page
 * assembles a day's cards from six independent, independently-paginated endpoints; each card already
 * carries its own display time in its payload. This helper only decides the vertical order — no
 * business rule, price, or status is computed here.
 *
 * Contract: takes `entries` of shape `{ key, time, node, rank? }` where `time` is an "HH:MM" string
 * (or null/empty for a time-less card, e.g. a plugin's laundry card or an option without a set hour).
 * Returns a NEW array ordered by time ascending, time-less entries last. Among the time-less ones,
 * `rank` orders them (absent = 0, so the core's own cards come first; a `planning.days` contribution
 * sets its own — specs/plugins-phase-2-hosts.md rule 5). Ties keep insertion order (stable).
 */

function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

export function orderDayEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry, index) => ({ entry, index, minutes: timeToMinutes(entry && entry.time), rank: Number(entry && entry.rank) || 0 }))
    .sort((a, b) => {
      if (a.minutes == null && b.minutes == null) return (a.rank - b.rank) || (a.index - b.index);
      if (a.minutes == null) return 1;
      if (b.minutes == null) return -1;
      if (a.minutes !== b.minutes) return a.minutes - b.minutes;
      return a.index - b.index;
    })
    .map((x) => x.entry);
}

export default orderDayEntries;
