- **The server suite no longer follows the app variables of the developer's shell either** (spec
  `server-test-isolation.md` rule 12, reading of 2026-11-01, audit R13 L-1). Besides `GUESTFLOW_*`, the `npm test`
  preload now deletes every other variable the server reads (`PUBLIC_SITE_ORIGIN`, the `*_RATELIMIT_*` knobs,
  `QONTO_*`, `VAPID_*`, `TLS_*`, `PORT`…), and a `NODE_ENV` other than `test`; `PATH`, `TZ` and the runner's
  `GUESTFLOW_TEST_*` knobs are kept. The list lives in `server/src/tests/setup/appEnvNames.js`, and a guard test
  derives the app's reads from `server/src/` so a new `process.env.X` missing from it fails; it also reads
  `env?.X` and lowercase names (pm2's `pm_id` is now stripped), and fails on any access it cannot read a name off
  (an alias of `process.env`, a computed or backtick key, `Reflect.get`…) outside the few files pinned by count. A
  shell exporting the production `PUBLIC_SITE_ORIGIN` or `PUBLIC_API_RATELIMIT_MAX=5` used to fail 4 tests. +8
  server tests.
