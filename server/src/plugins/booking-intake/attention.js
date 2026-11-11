/**
 * The Booking fiches to complete, as two subjects of the home (specs/shell-and-home-day-first.md
 * rules 6, 9): the arrivals within a week are urgent, the others « à faire » (specs/booking-extranet-intake.md
 * rule 24 draws the same line).
 */
const half = (urgent) => (payload) => {
  const n = (Array.isArray(payload) ? payload : []).filter((item) => Boolean(item.urgent) === urgent).length;
  if (!n) return null;
  return {
    count: n,
    title: urgent ? 'Réservations Booking à compléter, arrivée proche' : 'Réservations Booking à compléter',
    detail: `${n} ${n > 1 ? 'fiches à compléter' : 'fiche à compléter'}`,
    severity: urgent ? 'urgent' : 'todo',
  };
};

module.exports = { summarizeUrgent: half(true), summarizeLater: half(false) };
