/**
 * The gate keys as a subject of the home (specs/shell-and-home-day-first.md rules 3, 6, 9): pinned,
 * urgent — a guest at a closed gate is the cost of missing it. Counted from the card's own payload.
 */
function summarize(payload) {
  const failures = Array.isArray(payload && payload.failures) ? payload.failures.length : 0;
  const stale = Boolean(payload && payload.stale);
  const count = failures + (stale ? 1 : 0);
  if (!count) return null;
  return {
    count,
    title: 'Clés portail',
    detail: [
      stale ? 'Sowel ne lit plus les clés' : null,
      failures ? `${failures} ${failures > 1 ? 'clés en échec' : 'clé en échec'}` : null,
    ].filter(Boolean).join(' · '),
    severity: 'urgent',
  };
}

module.exports = { summarize };
