// specs/public-request-abuse-and-grouping.md rule 11 — above this many requests in an hour, the card
// says the traffic is unusual.
const UNUSUAL_PER_HOUR = 20;

/** The website's pending requests, as a subject of the home (specs/shell-and-home-day-first.md rules 6, 9). */
function summarize(payload) {
  const n = Array.isArray(payload && payload.alerts) ? payload.alerts.length : 0;
  if (!n) return null;
  const lastHour = Number((payload && payload.requestsLastHour) || 0);
  const detail = lastHour > UNUSUAL_PER_HOUR
    ? `${n} devis en attente · ${lastHour} demandes en une heure — trafic inhabituel`
    : `${n} devis en attente`;
  return { count: n, title: 'Demandes de devis depuis le site', detail, severity: 'info' };
}

module.exports = { summarize };
