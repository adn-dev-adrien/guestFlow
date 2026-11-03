- **Test suites — no date is left for the five-year window to drop, and the suite passes after midnight** (audit
  R20-S1 and R20-S2, `server-test-isolation.md` rules 6 and 7). Since the date window of 2026-11-02, a past
  date a test hands to a write path is refused once it is five years old: 136 server tests in 43 files would
  have gone red from 2031-01-02, and one client test from 2031-06-02. They now build their dates from today,
  as does the bank reconciliation fixture. `stored-split-only-with-contribs` no longer fails between 00:00 and
  01:00 in Paris: it read « today » as the UTC day, as three other suites did. `check-test-dates.mjs` now also
  names a past date down to today − 5 years, and a « now » a test only injects no longer exempts its dates,
  since the window reads the real clock. No product change.
