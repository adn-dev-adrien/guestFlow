- **The server suite no longer follows the GuestFlow flags of the developer's shell** (spec
  `server-test-isolation.md` rule 12, review of PR #919). The `npm test` preload deletes every `GUESTFLOW_*`
  variable but the runner's `GUESTFLOW_TEST_*` knobs at start-up; tests that need a flag set it inline or pass
  an `env`. A shell exporting `GUESTFLOW_MANAGED=1` used to fail 50 tests; `GUESTFLOW_DISABLE_OUTBOUND=1` and
  `GUESTFLOW_SELF_UPDATE=off` could change outcomes too. The E2E servers, which set `GUESTFLOW_DISABLE_OUTBOUND`
  on purpose, never load the preload. +4 server tests.
