// The pure half of the SAS « Planifier » step (specs/plugins-phase-3c-hourly-resources.md rule 12):
// no SDK import, so the module list can reach it without a cycle.

export function dayLabel(day) {
  return day.weekdayLabel || day.date;
}

/**
 * The blocks a re-opened SAS starts from: the hours already placed, in the shape a freshly placed
 * block has (specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 rule 26).
 */
export function seedResourceBlocks(scheduling) {
  return (scheduling?.resources || []).flatMap((resource) => (resource.sessions || []).map((session) => {
    const day = (resource.days || []).find((d) => d.date === session.date);
    const [sh, sm] = String(session.start).split(':').map(Number);
    const [eh, em] = String(session.end).split(':').map(Number);
    return {
      resourceId: resource.resourceId,
      date: session.date,
      dayLabel: day ? dayLabel(day) : session.date,
      start: session.start,
      end: session.end,
      supplement: Number(session.supplement || 0),
      durationMinutes: Math.max(0, (eh * 60 + em) - (sh * 60 + sm)),
    };
  }));
}
