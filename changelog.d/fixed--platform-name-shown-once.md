- **A platform is listed once in the calendar, whatever its stored casing**
  (specs/normalize-platform-names.md, addendum 2026-08-24). The legend showed « Abracadaroom » **and**
  « abracadaroom », two swatches for one channel. The cause was at the write site: the iCal sync stored
  the feed *slug* (`abracadaroom`, `gites-de-france`) as the reservation's platform, where a manually
  created booking carried the canonical name. Every restart healed the drift and every sync re-created
  it — and production runs for weeks between restarts. The sync now writes the canonical name (the slug
  stays in the column that identifies the feed), and the boot cleanup additionally normalises
  reservations whose spelling matches no catalogue row, adopting the catalogue's spelling rather than
  inventing a variant of it.
- **The rule holds for every platform: case is not identity.** The legend merges the variants of one
  name and sorts them alphabetically — so it no longer reshuffles as months load — and each name reads
  with a leading capital, inner capitals untouched (« GitesDeFrance » stays as it is, « BOOKING »
  becomes « Booking »). The platform chips elsewhere in the app (accounting, finance, clients,
  payments) read that same label, so they can no longer contradict the legend.
