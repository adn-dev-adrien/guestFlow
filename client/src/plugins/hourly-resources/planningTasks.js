// The hourly resources' share of the day counter on the planning
// (specs/plugins-phase-3c-hourly-resources.md rule 22). Pure: the module list reaches it without a cycle.

/** Rule 22 — the day's tickable cards: the ignitions and the sessions. A booking has nothing to tick. */
export function countResourceTasks(entries) {
  const tickable = (entries || []).filter((e) => e.kind !== 'booking');
  return { total: tickable.length, done: tickable.filter((e) => Boolean(e.item.done)).length };
}
