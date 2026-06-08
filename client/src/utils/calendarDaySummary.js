/**
 * Pure helpers for the mobile week view (specs/calendar-mobile-view.md).
 *
 * Given a YYYY-MM-DD date + the selected property's reservations / devis, return the day's
 * events as plain data the week view renders as readable lines. No DOM, no React — unit-tested.
 *
 * One property at a time, so a day has at most one arrival, one departure (a different
 * reservation can arrive the same day a previous one leaves) and one ongoing (mid-stay) row.
 */

export function buildDaySummary(dateStr, reservations = [], devisList = []) {
  const arrival = reservations.find((r) => r.startDate === dateStr) || null;
  const departure = reservations.find((r) => r.endDate === dateStr) || null;
  const ongoing = reservations.find((r) => dateStr > r.startDate && dateStr < r.endDate) || null;

  // Devis (quotes) only surface where no reservation already occupies the slot.
  const devis = [];
  if (!arrival && !ongoing) {
    const d = devisList.find((x) => x.startDate === dateStr);
    if (d) devis.push({ kind: 'arrival', devis: d });
  }
  if (!departure && !ongoing) {
    const d = devisList.find((x) => x.endDate === dateStr);
    if (d) devis.push({ kind: 'departure', devis: d });
  }
  if (!arrival && !departure && !ongoing) {
    const d = devisList.find((x) => dateStr > x.startDate && dateStr < x.endDate);
    if (d) devis.push({ kind: 'ongoing', devis: d });
  }

  return { arrival, departure, ongoing, devis };
}

export function isEmptyDay(summary) {
  return !summary.arrival && !summary.departure && !summary.ongoing && summary.devis.length === 0;
}

// Monday-of-week for a Date (FR weeks start Monday). Returns a new Date at local midnight.
export function getMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

// The 7 Date objects of the week starting at `monday`.
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return d;
  });
}
