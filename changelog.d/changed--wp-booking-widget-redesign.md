- WordPress booking widget redesigned as the single unified widget (spec `wp-booking-widget-redesign`):
  dates are picked exclusively on an embedded availability calendar (read-only date fields, blocked
  ranges refused), the party and every quantity use stepper controls, and options + resources render
  in one uniform list. Resources (bain nordique…) are now bookable from the site with a server-driven
  « À planifier avec l'hôte » note on hourly resources; the note no longer shows on planning-card
  options. Public resource projection gains `priceUnitLabel`, `quantityLabel` and
  `showsSchedulingNote`. Plugin bumped to 1.4.0.
