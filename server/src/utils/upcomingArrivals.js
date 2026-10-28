/**
 * « Réservations à venir », shaped for display (specs/upcoming-reservations-cards.md rule 6): the
 * arrivals grouped by day, each day with its French label, whether it is today, and how many of its
 * stays are ready. The page renders this and counts nothing (CLAUDE.md §6.0).
 */

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});

const DAY_LABEL_WITH_YEAR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

/**
 * `2026-10-23` → `vendredi 23 octobre`. With `today` given, a day outside today's year carries its
 * year (`samedi 3 avril 2027`), so a date months away is never read as this year's.
 */
function frenchDayLabel(isoDate, today) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const otherYear = today && String(isoDate).slice(0, 4) !== String(today).slice(0, 4);
  return (otherYear ? DAY_LABEL_WITH_YEAR : DAY_LABEL).format(d);
}

/**
 * @param {object[]} reservations detailed reservations, already in arrival order
 * @param {string} today `YYYY-MM-DD`, the server's calendar day
 * @returns {{ today: string, days: object[] }}
 */
function groupArrivalsByDay(reservations, today) {
  const days = [];
  for (const reservation of reservations) {
    let day = days[days.length - 1];
    if (!day || day.date !== reservation.startDate) {
      day = { date: reservation.startDate, label: frenchDayLabel(reservation.startDate, today), isToday: reservation.startDate === today, reservations: [] };
      days.push(day);
    }
    day.reservations.push(reservation);
  }
  return {
    today,
    days: days.map((day) => {
      const readyCount = day.reservations.filter((r) => Boolean(r.checkInReady)).length;
      return { ...day, readyCount, total: day.reservations.length, allReady: readyCount === day.reservations.length };
    }),
  };
}

module.exports = { groupArrivalsByDay, frenchDayLabel };
