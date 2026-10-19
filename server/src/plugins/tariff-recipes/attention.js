/**
 * The seasonal calendar's runs to read as a subject of the home (specs/shell-and-home-day-first.md
 * rules 6, 9): « à faire » when a run blocks or an event's dates are missing, « pour info » otherwise.
 */
function summarize(payload) {
  const runs = Array.isArray(payload && payload.runs) ? payload.runs : [];
  const missing = Array.isArray(payload && payload.missingEvents) ? payload.missingEvents : [];
  const count = runs.length + missing.length;
  if (!count) return null;
  const blocking = missing.length > 0 || runs.some((run) => Number(run.blocking) === 1);
  return {
    count,
    title: 'Calendrier saisonnier',
    detail: `${count} ${count > 1 ? 'points à relire' : 'point à relire'}`,
    severity: blocking ? 'todo' : 'info',
  };
}

module.exports = { summarize };
