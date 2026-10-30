# Server tests never touch the checkout's database

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/audit-hygiene` |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (audit hygiene batch) |

---

## 1. Context

The audit of 2026-10-28 found three server tests (`airbnb-no-checkout-chores`, `reservations-commission`,
`hourly-resources/sas-preview-hook`) that load `models/reservationsModel` → `database.js` without setting
`DB_PATH`. `database.js` then creates and migrates `server/guestflow.db` — in a developer's main checkout
that file is often a copy of production, so running a branch's suite applied that branch's migrations to it.

## 2. Goal

Running `npm test` can never create, open or migrate the checkout's own `server/guestflow.db`, and never
hangs on a test that does not settle (rule 5). A suite does not go red because the calendar moved
(rules 6-7), and the unit suites fit their CI time budget (rule 8).

## 3. Functional rules

1. **Every test process gets its own database.** `npm test` preloads `src/tests/setup/isolateDefaultDb.js`
   (`node --require`) into each test process: it sets `DB_PATH` to a fresh file in the OS temp directory and
   clears `PERSISTENT_DB`. A test that needs its own location still sets `DB_PATH` itself, as before.
2. **Opening the default path fails loudly.** The same preload wraps `better-sqlite3`: opening
   `server/guestflow.db` (or its `-wal` / `-shm`) throws « A test opened the checkout's own database », so a
   test that bypasses rule 1 fails instead of silently migrating a real file. `:memory:` is untouched.
3. **The three offenders set their own temporary database** at the top of the file, so they are safe when run
   alone (`node --test <file>`), without the preload.

4. **Rules 1-2 hold without the preload too** (added 2026-10-29). `database.js` and `utils/instancePaths.js` call
   `utils/testProcessIsolation.js`: under the test runner (`NODE_TEST_CONTEXT`, set in every `node --test` child),
   a process that names no `DB_PATH` / `PERSISTENT_DB`, `GUESTFLOW_LOCAL_ENV` or `GUESTFLOW_UPLOADS_DIR` gets
   them in a private temp directory (`<tmp>/data/guestflow.db`, `env.local`, `uploads/`), removed at exit.
   The preload uses the same module (forced), so the deploy root resolved from `DB_PATH` is the private
   directory and not the shared `$TMPDIR`, and `server/.env.local` is never written by a suite. With the
   preload (`npm test`) the process's `TMPDIR` is moved to `<tmp>/tmp` before any suite loads, so the scratch
   directories suites create with `os.tmpdir()` (≈500 per full run before: `gf-phase4-*`,
   `gf-website-booking-*`, `gvr-*`…) are removed with the process. Without the preload, `TMPDIR` moves only
   when `database.js` / `instancePaths.js` is first required, so a suite that creates its scratch directory
   before that (`website-booking/tests/isolatedDb.js`, required first by design) leaves it behind (audit R3,
   2026-10-29: 119 directories after a whole run without the preload). That leftover is harmless data-wise —
   no checkout file and no real secret is touched, which is what rules 1-2 guarantee.

5. **A test that never settles fails, it does not stall the job** (added 2026-10-30, audit R7 L-2; amended the
   same day after the CI run of PR #896). The `test` scripts of `server/package.json` and
   `control-plane/server/package.json` pass `--test-timeout` — 60 000 ms for the server, 180 000 ms for the
   control plane, whose lifecycle integration test gives itself 170 s — and `--test-force-exit`.
   - **What the limit applies to depends on Node.** Node 22 applies it to each test FILE as a whole under
     process isolation (the report names the file, « test timed out after … »). Node ≥ 24 — the CI's
     `node-version: '24'` — applies it to each TEST (nodejs/node#57672) and the report names the test. Both
     values therefore stay above the slowest file: on 2026-10-30 the whole server suite (8 672 tests) passed
     under them on Node 22 on a loaded machine, slowest file 8.1 s; the control plane (312) passed in 28 s.
     On CI the slowest single test was 4.4 s.
   - **`--test-force-exit` ends the child.** On Node 24 a timed-out test is reported, but the handle it left
     open (a listening server, an interval) keeps its file's process alive, so the run still stalled until
     the CI cancelled the job. With force-exit the runner ends the process once its tests are reported: the
     hanging file fails within its limit on both Node 22 and Node 24.
   Before, a regression in a « server that never answers » test (neat-timeout, reproduced by the audit) hung
   `npm test` for over 16 minutes and the CI cancelled the job at its 15-minute limit without naming the
   culprit. Vitest (client suites) already has its own 5 s per-test default. Test:
   `node-suite-test-timeout.unit.test.js`.

6. **A test's dates hang on today** (added 2026-10-30, audit R8 M-1). A test that compares a date with today
   — a stay « in the future », an acompte window, a journal month — builds it from today (`todayIso()` +
   `addDaysToIsoDate()` on the server), or pins the clock (`mock.timers`, `vi.setSystemTime`) when the calendar
   year is the subject. The four suites PR #893 added (`disabledAcompteLinkFixture.js` and the three
   `deposit-*` suites that use it) wrote June and November 2027 stays and a March 2027 payment: 3 tests red from
   2027-05-09, 26 from 2027-10-05, the CI server job and the release `tests` job failing with them. Their stays
   now start 60 days out and more (beyond the acompte window), the link is paid a week from now and the journal
   month is the one it was paid in. The same holds for `payment-links-converted-devis-double-payment` (rule 34
   red from 2027-05-10, a devis stay now 190 days out) and `deposit-due-date-and-override-history` (stays in
   October 2027, red from 2027-09-05, found by the same sweep). All six files were proven red at their bomb
   date with a clock-shift preload and green after, swept to 2030-01-02, under Europe/Paris, UTC and
   America/Los_Angeles.

7. **A PR adding a literal date to a test is told so, on the line** (added 2026-10-30, audit R8 M-1, the guard
   audit R7 proposed). `scripts/check-test-dates.mjs --base <ref>` reads only the test lines a PR adds (files of
   a `tests/`, `__tests__/` or `e2e/` folder, and every `*.test.*` / `*.spec.*`), and names a quoted
   `YYYY-MM-DD` — or a `Date.UTC(YYYY, …)` / `new Date(YYYY, …)` year — from today to ten years out. Not
   named: comment lines; a line carrying `date-literal-ok`, or under one (« `// date-literal-ok: <why>` », for
   a date nothing compares with today, such as the input of a pure function); every line of a file that pins
   the clock (`setSystemTime(`, `mock.timers.enable(` / `setTime(`); and a date further out, a deliberate far
   future (`2099-06-01`). The `spec rules` job of `unit-tests.yml` runs it on every PR **as a warning** — a
   GitHub annotation on the line, the list in the log — and `--strict` makes it fail. Why a warning: replayed
   on the 40 PRs merged into inte/plugins before 2026-10-30, it named lines in about half of them, many being a
   date the test hands to the code as its « now » (`const MINTED = new Date('2026-11-02T08:00:00Z')`), which
   only the author can tell from a bomb. A clock-shift run of the changed files was weighed and rejected: at
   +400 days the whole server suite has 157 red tests, most of them dates of 2027 that are bombs with a longer
   fuse, and every PR touching one of those files would go red for a date it did not write. Test:
   `test-suite-calendar-and-ci-budget.unit.test.js`.

8. **The client unit suite runs in three shards** (added 2026-10-30, audit R8 M-2). The `client` job of
   `unit-tests.yml` is a matrix of three (`vitest run --shard=N/3`, `fail-fast: false`), each under its own
   15-minute cap; the production build and the bundle budget (specs/inte-performance.md rule 4) run in shard 1
   only. Vitest splits the test FILES, so each shard keeps per-file isolation and the per-file `vi.mock`
   hoisting the one-file-per-subject rule relies on — `isolate: false` stays off for that reason. Why: every
   client test file pays its own fork, jsdom environment and imports (≈1.1 s on the runner), and that rule took
   the suite from 220 files (2026-10-25) to 625 (2026-10-30). In one job the suite took 711 s (up to 798 s)
   of its 900 s cap; locally each third runs in ≈52 s for ≈1 030 tests. The release workflow is split the same
   way (specs/self-update-and-releases.md rule 52). Test: `test-suite-calendar-and-ci-budget.unit.test.js`.

**Edge cases:**
- A targeted `node --test <file>` used to open and migrate `server/guestflow.db` for 389 test files (audit R2,
  2026-10-29); rule 4 closes that. Rule 3 stays as the explicit guard of the three first offenders.
- Only a process outside the test runner (e.g. `node -e`) opens the default path. `node --test --experimental-test-isolation=none`
  runs the files in the parent process, where `NODE_TEST_CONTEXT` is not set: that mode is isolated only with the
  preload (`npm test` never uses it). A process with `NODE_ENV=production` is never isolated, even under the runner.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `tests/setup/` | `isolateDefaultDb.js` | C | Preload: temp `DB_PATH` / `.env.local` / uploads per process + guard on the default path. |
| `utils/` | `testProcessIsolation.js` | T | Rule 4: same isolation for a process run without the preload. |
| `database.js`, `utils/instancePaths.js` | | T | Call it before reading the environment. |
| `tests/` | `server-test-isolation.unit.test.js` | C | Pins rules 1-2 in a child process. |
| `tests/`, `plugins/hourly-resources/tests/` | the three offenders | T | Rule 3. |
| `package.json` | `test` script | T | `--require ./src/tests/setup/isolateDefaultDb.js`; `--test-timeout=60000 --test-force-exit` (rule 5). |
| `control-plane/server/package.json` | `test` script | T | `--test-timeout=180000 --test-force-exit` (rule 5). |
| `tests/` | `node-suite-test-timeout.unit.test.js` | C | Pins rule 5: both values, force-exit in both scripts, and that a hanging test fails within its limit on Node 22 and 24. |
| `tests/` | `disabledAcompteLinkFixture.js`, `deposit-collected-by-link-kept-on-save`, `deposit-link-paid-on-disabled-acompte`, `deposit-due-date-and-override-history`, `payment-links-converted-devis-double-payment` | T | Rule 6: dates built from today. |
| `scripts/` (repo root) | `check-test-dates.mjs` | C | Rule 7: names the literal dates of the test lines a PR adds; warns, `--strict` fails. |
| `.github/workflows/` | `unit-tests.yml` | T | Rule 7: a `spec rules` step runs the check. Rule 8: the `client` job is a 3-shard matrix; build and bundle budget in shard 1. |
| `.github/workflows/` | `release.yml` | T | Rule 8 / self-update rule 52: `tests` split into `server-tests` and a 3-shard `client-tests`. |
| `tests/` | `test-suite-calendar-and-ci-budget.unit.test.js` | C | Pins rules 6-8 and self-update rule 52. |

### 4.2 Client side

None. API, data model and UI are unchanged.

## 7. Test plan

- [x] `server-test-isolation.unit.test.js`: the preload sets a temp `DB_PATH` (rule 1), refuses the default path and its `-wal` / `-shm` (rule 2), allows `:memory:` and the temp file.
- [x] Rule 4: a single file run (`settings-model`) without preload leaves `guestflow.db` / `.env.local` / `uploads` untouched; under `NODE_TEST_CONTEXT` the three defaults are in the temp dir.
- [x] Rule 3: the three tests, run alone with `server/guestflow.db` removed, leave no file behind.
- [x] Rule 5: `node-suite-test-timeout.unit.test.js` (2 tests) reads both scripts (timeouts + `--test-force-exit`) and runs a hanging file under a 300 ms limit with force-exit; passes on Node 22.22.2 and 24.22.2.
- [x] Rule 6: the six files carry no literal date the calendar will pass (`findDateBombs` over their whole content); with the R7 clock-shift preload they were red before the change (3 tests at 2027-05-09, 16 at 2027-06-08, 26 at 2027-10-05, rule 34 from 2027-05-10, 1 of the due-date file at 2027-09-05) and are 48/48 green at 2026-10-30 09:30Z and 23:30Z, 2027-05-09, 06-08, 09-05, 10-05, 12-31 22:30Z, 2028-02-29 and 2030-01-02.
- [x] Rule 7: `test-suite-calendar-and-ci-budget.unit.test.js` — a quoted date and a `Date.UTC` year are named with file and line; only added lines are read, numbered as the diff numbers them; the marker, a pinned clock, a comment, the far future and non-test files are not named; the PR job runs it without `--strict`.
- [x] Rule 8: the same file reads the `client` job (3 shards, `fail-fast: false`, budget in shard 1) and the release jobs (self-update rule 52). The three shards locally: 209 / 208 / 208 files, 1 026 + 1 029 + 1 033 = 3 088 tests, the full suite's count.

## 8. Out of scope

- E2E runs write `server/.env.local` through `instancePaths`; that is a separate, by-design path.
