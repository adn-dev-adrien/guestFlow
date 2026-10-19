/** The website's pending requests, as a subject of the home (specs/shell-and-home-day-first.md rules 6, 9). */
function summarize(payload) {
  const n = Array.isArray(payload && payload.alerts) ? payload.alerts.length : 0;
  return n ? { count: n, title: 'Demandes de devis depuis le site', detail: `${n} devis en attente`, severity: 'info' } : null;
}

module.exports = { summarize };
