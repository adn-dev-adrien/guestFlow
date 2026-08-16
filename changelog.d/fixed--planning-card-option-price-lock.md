- **Planning-card options are no longer re-priced on an existing booking** (spec
  `devis-extras-parity-and-price-lock.md` §3 rule 13bis, 2026-08-16). A `showsPlanningCard` option
  (petit déjeuner, repas) is billed from its occurrences, so its line was rebuilt on every save and
  escaped the price lock that freezes every other option: raising a catalogue or per-property price
  re-priced reservations already sold and paid, and the difference resurfaced as an unexplained
  « complément de fin de séjour ». The engine now replays the unit price the line was sold at —
  « Utiliser les tarifs actuels » stays the only way to re-price. +7 server tests.
