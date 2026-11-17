- `plugin:guest-app` — « Domotique »: every figure shown is a value Sowel already holds. Rooms show the day's
  min/max (Sowel's `temperature_min_today` / `_max_today`, absent until `sowel-core` spec 211 extends them to plain
  thermometers); the trend arrow and the rain totals summed from the bars are gone; a new « Réseau » block shows the
  main meter's power as Sowel's energy page does, green when the surplus goes back to EDF, red when drawn. The house
  is « en direct » while it polls, so an unchanged value is no longer muted (specs/guest-app-home-automation.md
  rules 24-29).
- `plugin:gate-access` — the home connector accepts batches of changed readings only and keeps no trend samples.
