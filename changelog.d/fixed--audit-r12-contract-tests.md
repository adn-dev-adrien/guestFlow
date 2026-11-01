- **The plugin payment-provider contract documents `pending`, and the self-update tests no longer read the shell
  environment** (audit R12, spec `plugins-phase-3a-online-payment.md` rule 4, reading of 2026-11-01). The rule 4
  table now gives `getPayment(linkId)` as `{ paid, pending, paymentId?, paidAt? }`: `pending` is a required boolean
  for the read after a `dates-taken` deactivation, and an answer without it counts as in flight
  (`payment-link-lifecycle.md` rule 64). A new test keeps that table and `utils/paymentProviders.js` on the same
  fields, `?` marks included, so `pending` cannot turn optional unnoticed. The `runVersionCheck` tests pass an explicit environment, so a shell carrying `GUESTFLOW_DISABLE_OUTBOUND=1`
  or `GUESTFLOW_MANAGED=1` no longer turns them red or, for the offline case, vacuously green; `buildVersionInfo`
  hands its environment to `selfUpdateSupported` as well, pinned by a `GUESTFLOW_SELF_UPDATE=off` case
  (`self-update-and-releases.md` rule 51, reading of 2026-11-01). +3 server tests.
