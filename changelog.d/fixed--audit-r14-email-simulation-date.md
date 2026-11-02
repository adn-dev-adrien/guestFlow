- **A client test no longer turns red on 2026-11-02** (spec `ui-review-2026-10-19-operations.md` rule 39). The
  stale-range test of `EmailSequenceSimulation` moved « Au » to the literal `2027-01-01`, which is the default end
  (today + 60 days) on that day, so no second simulation started; it now moves it to today + 90 days. Test only.
