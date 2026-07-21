- iCal sync no longer duplicates imported reservations after a transient bad feed response
  (2026-07-21 Gîtes de France incident): the matching cascade now re-claims reservations by their
  stored feed UID, a suddenly-empty feed is only trusted from the 2nd consecutive empty fetch
  (new `ical_sources.emptyFeedStreak` counter, first hit surfaces as a sync error), non-ICS 200
  bodies are rejected, and matched reservations missing `icalOriginalSummary` are backfilled.
