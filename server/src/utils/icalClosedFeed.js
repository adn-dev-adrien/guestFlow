/**
 * Feeds that mark every stay « CLOSED - Not available » (specs/lodgify-decommission.md §3 rule 16).
 *
 * Booking.com's iCal export gives every taken night that summary, real reservations included, so the
 * parser must keep those events and the sync must treat them as nameless stays (echo filter, exact-date
 * re-claim). Which source behaves like that is a per-source setting, `ical_sources.feedMarksStaysClosed`.
 * This module only provides its default: a source whose platform reads « booking… » under any spelling
 * (`booking`, `booking-com`, `BookingTente`…). It seeds new sources and the one-shot migration, and it
 * decides for a source whose setting is NULL (never chosen) or a schema without the column.
 */
function compactSlug(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function defaultMarksStaysClosed(...labels) {
  return labels.some((label) => compactSlug(label).startsWith('booking'));
}

// One-shot (`migrations.ical_feed_marks_stays_closed_v1`, run from database.js): every existing source
// whose platform reads « booking… » gets the setting the sync used to infer from the exact slug
// `booking`. Run once, so an operator who later unticks a source keeps it unticked. Returns the count.
function runClosedFeedMigration(database) {
  const tick = database.prepare('UPDATE ical_sources SET feedMarksStaysClosed = 1 WHERE id = ?');
  const ticked = database.prepare('SELECT id, platformKey, platformLabel, name FROM ical_sources').all()
    .filter((s) => defaultMarksStaysClosed(s.platformKey, s.platformLabel, s.name));
  ticked.forEach((s) => tick.run(s.id));
  return ticked.length;
}

module.exports = { defaultMarksStaysClosed, compactSlug, runClosedFeedMigration };
