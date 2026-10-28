/**
 * Pure helpers for the phone's day agenda (specs/calendar-mobile-view.md, amended by
 * specs/calendar-property-parity.md rule 17).
 *
 * Given a YYYY-MM-DD date + the selected property's reservations / devis, return the day's
 * events as plain data the agenda renders as ribbons. No DOM, no React — unit-tested.
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
