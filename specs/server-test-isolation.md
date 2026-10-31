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
hangs on a test that does not settle (rule 5), and never reports green with tests of a file left unrun
(rule 10). A suite does not go red because the calendar moved
(rules 6-7, 9), and the unit suites fit their CI time budget (rule 8). A client test does not go red
because the runner is busy (rule 11).

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
   control plane, whose lifecycle integration test gives itself 170 s — and preload the exit watchdog
   `scripts/test-runner/test-exit-watchdog.cjs` (`--require`). `--test-force-exit` is withdrawn (2026-10-30,
   audit R9 M-1): see the last point and rule 10.
   - **What the limit applies to depends on Node.** Node 22 applies it to each test FILE as a whole under
     process isolation (the report names the file, « test timed out after … »). Node ≥ 24 — the CI's
     `node-version: '24'` — applies it to each TEST (nodejs/node#57672) and the report names the test. Both
     values therefore stay above the slowest file: on 2026-10-30 the whole server suite (8 672 tests) passed
     under them on Node 22 on a loaded machine, slowest file 8.1 s; the control plane (312) passed in 28 s.
     On CI the slowest single test was 4.4 s.
   - **The exit watchdog ends the child.** On Node 24 a timed-out test is reported, but the handle it left
     open (a listening server, an interval) keeps its file's process alive, so the run still stalled until
     the CI cancelled the job. The watchdog, registered as a root `after` hook in every test file's child
     process, gives that process 30 s to exit once its last test is reported; past it, it writes
     « <file> is still running 30000 ms after its last test: a handle it left open … keeps it alive » and
     exits 1. The hanging file fails within its limit plus 30 s on Node 24, within its limit on Node 22 (whose
     file timeout fires first), and a file whose tests all pass but which leaves a handle open fails too,
     named, instead of stalling. `GUESTFLOW_TEST_EXIT_GRACE_MS` shortens the grace for the rule's own test.
   - **Why not `--test-force-exit`** (amended 2026-10-30, audit R9 M-1). It did the same job from 2026-10-30
     until the audit caught it ending a file's process before its last tests: under load the runner reached
     its « every known test finished » point with top-level tests still queued, exited 0, and the run
     reported only the tests that had run. On GitHub CI, unit-tests run 41098351686 reported 8 898 tests
     green where the identical tree reported 8 910 — the last 12 tests of `sas-commit.unit.test.js` never
     ran. Locally, 7 of 20 parallel runs of two files were cut short with force-exit, 0 of 20 without. The
     watchdog only acts 30 s after that point, so a file whose tail is still running is left to finish, and
     rule 10 fails the run if a process ever ends early anyway.
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
   now start 60 days out and more (beyond the acompte window), the solde is ticked eight days ago and the link
   paid seven days ago (a paid date is never ahead of now), and the journal month is the one it was paid in.
   The same holds for `payment-links-converted-devis-double-payment` (rule 34 red from 2027-05-10, a devis stay
   now 190 days out) and `deposit-due-date-and-override-history` (stays in October 2027, red from 2027-09-05,
   found by the same sweep). All six files were proven red at their bomb date with a clock-shift preload and
   green after, swept to 2030-01-02, under Europe/Paris, UTC and America/Los_Angeles.
   The review of that fix found older fuses still burning (2026-10-30): stays of January to May 2027 in
   `reservation-overpayment`, `kept-money-priced-closes-trop-percu`, `trop-percu-refund-books`, the
   accounting-export plugin's `accounting-paid-then-reduced` (all red from 2027-01-24), `hourly-session-overlap`,
   `reservation-time-change-overlap`, `ledger-stored-deposit-ceiling`, `platform-paid-solde-follows-statement`
   (red from 2027-02-12), and the `reservationSaveFixture.js` family — its default stay of 2027-07-20 and 2027 or
   2028 stays in its suites, 20 tests red at 2027-05-25 and 27 at 2027-07-21. Their stays now hang on today the
   same way (`inDays(n)`, the fixture's default 270 days out, `f.inDays` exported to its suites), each keeping
   the gaps between its stays. A date handed to a pure function (the session-overlap check and its French
   message, `resolveDepositDueDate`) stays literal under the rule 7 marker. Every suite of the fixture is read
   by the rule 6 test, found by its `require`, so a new one is held to the rule without being listed.
   The second review (2026-10-30) swept the whole server suite and found the next fuses: `clients-no-duplicate-
   and-draft` (red from 2027-03-11), `reservation-overpayment-by-poste` (2027-03-24), `calendar-parity-
   superseded` (2027-04-17), `clients-duplicate-created-from-the-fiche` (2027-05-11), the accounting-export
   plugin's `stay-payment-split-fallback` (2027-06-05), `baby-bed-line-stored-on-create` (2027-06-25),
   `ical-nameless-summary-matching` and `lodgify-decommission-native-feeds` (2027-07-11, iCal feeds included),
   and the `ledgerFixture.js` family — its default stay of 2027-07-20 and its one-stay-a-week slots from
   2027-07-05, behind nine suites red from 2027-06-05 to 2027-07-06. The fixture's default stay is now
   `inDays(270)` and its slots `inDays(255 + 7n)`, the same gaps, with `inDays` exported; its suites' stays,
   paid dates (a week ago, never ahead of now) and drifted due dates hang on it, and the rule 6 test reads the
   whole family, found by its `require`, as for the save fixture. The same sweep then found the two
   controller-created stays of `reservation-number-after-cancellation` red from 2027-07-21, now `inDays` too. A
   past-shaped stay or a fixed calendar window nothing compares with today (`calendar-parity-superseded`'s
   2026 fixture) keeps its date under the marker. After it, the whole server suite at 2027-03-11, 2027-05-25,
   2027-07-21 and 2027-10-05 (09:00Z, Europe/Paris) is red only on the seven mixed-clock tests of a JS-only
   clock shift — SQLite's `datetime('now')` and a `Date` captured before the shift disagree with the shifted
   `Date`: `public-request-purge` ×2, `booking-pace` §5, `revenueByChannel`, `payment-poll-runner` and
   `reservation-number` ×2 — the same seven the reviews saw from the first shifted date (2026-12-01), green on
   the real calendar. The final review (2026-10-30) found one fuse past that last date: `ical-cancelled-stay-
   dropped`, red from 2027-11-11, whose feed held compact iCal dates (`'20271105'`) the guard did not read.
   Its feed now hangs on today too (`icalDay(n)`), it joins the rule 6 test, and rule 7 reads the compact
   form. The 78 compact literals of five other iCal suites (`ical-import-hardening` holds 54), green through
   2028-03-01, are left as they are: rule 7 reads only added lines,
   and rule 9 sets aside the unchanged ones an integration or sync PR carries.

7. **A PR adding a literal date to a test is told so, on the line** (added 2026-10-30, audit R8 M-1, the guard
   audit R7 proposed). `scripts/check-test-dates.mjs --base <ref>` reads only the test lines a PR adds (files of
   a `tests/`, `__tests__/` or `e2e/` folder, and every `*.test.*` / `*.spec.*`), and names a quoted
   `YYYY-MM-DD`, a quoted iCal `YYYYMMDD` (alone or opening a `…T090000Z` timestamp), a template opening on a year (`` `2028-${m}-10` ``), or a `Date.UTC(YYYY, …)` /
   `new Date(YYYY, …)` year, from today to ten years out. Not named: comment lines; a line carrying
   `date-literal-ok`, or under one (« `// date-literal-ok: <why>` », for a date nothing compares with today,
   such as the input of a pure function or a « now » the test hands to the code); the lines of a test that
   pins the clock; and a date further out, a deliberate far future (`2099-06-01`). A pin is
   `vi.setSystemTime(`, `mock.timers.setTime(`, `vi.useFakeTimers({ now })` whose `toFake` (when given)
   includes `'Date'`, or `mock.timers.enable(` whose `apis` include `'Date'` or are left out —
   `{ apis: ['setTimeout'] }` or `toFake: ['setTimeout']` leaves `Date` real and pins nothing. A clock the test
   injects is a pin too: a replaced `getTodayIsoDate` / `todayIso` (`reservationHelpers.getTodayIsoDate = () =>
   …`, not a local `const todayIso = …` helper), a `NOW` constant, or a `now:` handed to the code — unless it
   is the real clock (`new Date()`, `Date.now()`). A pin inside a `test` / `it` / `describe` call, a
   `test.each(…)(…)` callback included, exempts that call only, not the file's other tests; a pin in a named
   helper (`function freeze(t)`, `const freeze = (t) => …`, an object or class method `freeze(t) {…}` /
   `freeze: (t) => {…}`) exempts the helper and the calls that use it (`h.freeze(t)` for a method); a pin
   outside all of them (top level, a `beforeEach` / `test.beforeEach` hook at top level) exempts the file.
   Calls written inside strings and comments are not read as pins.
   The `spec rules` job of `unit-tests.yml` runs it with **`--strict`: a named line fails the PR** — the line
   annotated on GitHub, the list in the log. Resolved 2026-10-30 (Adrien): blocking, with the marker as the
   escape. A warning reached nobody — PRs are merged on their check buckets — and #893, replayed, would have
   merged with its 13 named lines. Replayed on the 45 PRs merged into inte/plugins from #850 to #897 (each on
   its merge day), it first blocked 22 of them on 217 lines, 95 of those in files that inject their own clock;
   with the injected clocks read as pins and rule 9, it blocks 17 on 162 (#871's 15 lines and half of #894's
   go). What is left is mostly real stays in 2027, and a date the test hands to the code under another name
   (`const MINTED = new Date('2026-11-02T08:00:00Z')`): those take the marker, one comment each. A clock-shift
   run of the changed files was weighed and rejected: at +400 days the whole server suite had 157 red tests,
   and every PR touching one of those files would go red for a date it did not write. Those 157 are not all
   « bombs with a longer fuse »: the reviews of 2026-10-30 found the first of them red from 2027-01-24, then
   2027-03-11, and rule 6 defused every one they named. Test: `test-suite-calendar-and-ci-budget.unit.test.js`.

8. **The client unit suite runs in three shards** (added 2026-10-30, audit R8 M-2). The `client` job of
   `unit-tests.yml` is a matrix of three (`vitest run --shard=N/3`, `fail-fast: false`), each under its own
   15-minute cap; the production build and the bundle budget (specs/inte-performance.md rule 4) run in shard 1
   only. Vitest splits the test FILES, so each shard keeps per-file isolation and the per-file `vi.mock`
   hoisting the one-file-per-subject rule relies on — `isolate: false` stays off for that reason. Why: every
   client test file pays its own fork, jsdom environment and imports (≈1.1 s on the runner), and that rule took
   the suite from 220 files (2026-10-25) to 625 (2026-10-30). In one job the suite took 711 s (up to 798 s)
   of its 900 s cap; locally each third runs in ≈52 s for ≈1 030 tests. The release workflow is split the same
   way (specs/self-update-and-releases.md rule 52). Test: `test-suite-calendar-and-ci-budget.unit.test.js`.

9. **A line already merged on a long-lived branch is not named again** (added 2026-10-30, review of PR #900).
   `check-test-dates.mjs --known <ref>,<ref>` sets aside an added line whose file already holds the same text
   (spaces around it aside) on one of those refs, and the `spec rules` step runs it with
   `--known origin/master,origin/inte/plugins`, fetching both first. Why: with `--strict` alone, the
   inte/plugins → master integration PR named 2 183 lines in 300 files, and every master → inte sync 6 to 25,
   all of them merged — and checked by this guard — on the other branch; marking them would mean editing that
   branch's content inside a merge PR. A ref that does not resolve (a branch removed) sets nothing aside, with
   a warning, and the check still runs. Lines are counted, not just looked up: an added line is set aside only
   while the head file holds it no more often than the known ref that holds it most. A feature PR that copies a
   known line into the same file is named — the original was accepted in its context (a pinned test, a marker
   on the line above), which the copy does not inherit; a review of 2026-10-30 probed exactly that, a line of a
   pinned test copied into an unpinned one and hidden by a presence check. Test:
   `test-suite-calendar-and-ci-budget.unit.test.js` (the pure filter and its counts, a real git repository
   replaying an integration PR, a feature PR and a copy out of a pinned test, and the workflow step).

10. **A suite never reports green with tests of a file left unrun** (added 2026-10-30, audit R9 M-1). The
   `test` scripts of `server/package.json` and `control-plane/server/package.json` keep the `spec` report on
   stdout and add `scripts/test-runner/test-completeness-reporter.mjs` on stderr. Per test file, every
   top-level test the file declared (the runner's `test:enqueue`) must be reported (`test:pass` — skips and
   todos included — or `test:fail`); a gap prints « ✖ <file>: N of M tests never reported — the file's
   process ended before them: » with each missing test named, and sets the exit code to 1. A file whose
   process ended before reporting any test (the runner then reports the file itself as one passing test)
   fails the same way (« no test reported »). Names are matched, not counts: the runner also enqueues one
   synthetic test per file, named after the file. Why: a child process that ends early is reported by
   `node --test` as a green, shorter run — that is how 12 tests went missing from a green CI job (rule 5),
   and the bucket-only merge gates (`merge-when-green.sh`, the release skill) only see the job's colour. The
   guard covers whatever ends a file early, not only force-exit: a test calling `process.exit(0)`, a native
   crash reported as exit 0. Replayed with `--test-force-exit` under load (two files, 40 parallel runs), it
   failed each of the 6 truncated runs and named the missing tests. Test: `node-suite-completeness.unit.test.js`.

11. **A client test awaits what an effect or a late answer produces** (added 2026-10-31, audit R10 M-1). After
   a `findBy*` or a `waitFor` on an API call, a client test asserts synchronously only what the SAME commit
   rendered. What lands later — a callback a component fires from a passive effect (`onStale` of
   `VatRegimeSwitchDialog`), a value set into an already rendered field, a row or option that the answer
   brings, a button enabled by it, a flag an effect clears — is awaited: `findBy*` on the element the
   assertion needs, or `waitFor` around the assertion. Why: React flushes passive effects, and commits
   outside `act`, in later scheduler tasks (`setImmediate` under Node); on a busy runner the testing
   library's drain timer can run first. That is how `VatRegimeSwitchDialog.switch.test.jsx` turned the
   inte/plugins head red on GitHub CI (run 41191292418, shard 1/3, « expected "vi.fn()" to be called at
   least once ») while it passed 18 of 18 local runs. The race is replayed on demand:
   `cd client && npm run test:slow-scheduler` runs the whole unit suite with
   `src/setupSlowScheduler.js` loaded first, which delays every `setImmediate` by `SCHED_DELAY` ms (8 by
   default, 2 also used) and, at the end of each file, waits for the tasks it still delays, which would
   otherwise run after jsdom is gone and fail the run with « window is not defined ». Before the change, 2 ms failed 10 tests in 9 files and 8 ms failed 11 in 10
   files; VatRegimeSwitchDialog run alone failed every run at 8 ms but only 1 of 6 at 2 ms, hence the
   default of 8 (amended 2026-10-31, review of #910). The sweeps after the first fixes named 4 more
   (3 files), and the 8 ms default one more (`CompensationsPage.test.jsx`, 1 run in 3). The 19 tests in
   16 files, and 2 siblings with the same pattern in those files, were fixed; after it, both delays pass
   the whole suite. A slower scheduler cannot catch the opposite mistake: an
   absence (`queryBy… toBeNull()`) asserted right after `waitFor(api called)` passes before the answer
   has rendered, so an absence check first awaits a positive anchor, a `findBy*` on something the same
   answer renders or, when the answer renders nothing, an `act` that awaits the answer itself. The sweep
   is manual: it never runs in CI (no workflow names it), and the normal `vitest.config.js` never loads
   it. Test: `client-effect-race-sweep.unit.test.js`.

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
| `package.json` | `test` script | T | `--require ./src/tests/setup/isolateDefaultDb.js`; `--test-timeout=60000` and the exit watchdog (rule 5); the `spec` and completeness reporters (rule 10). |
| `control-plane/server/package.json` | `test` script | T | `--test-timeout=180000` and the exit watchdog (rule 5); the `spec` and completeness reporters (rule 10). |
| `scripts/test-runner/` (repo root) | `test-exit-watchdog.cjs` | C | Rule 5: in each test file's child, exits 1 naming the file when it is still alive 30 s after its last test. |
| `scripts/test-runner/` (repo root) | `test-completeness-reporter.mjs` | C | Rule 10: fails the run and names the tests a file declared but never reported. |
| `tests/` | `node-suite-test-timeout.unit.test.js` | C | Pins rule 5: both values, the watchdog and no force-exit in both scripts, and under each script's own flags that a hanging test, and a passing file left with an open handle, fail named within their limit on Node 22 and 24. |
| `tests/` | `node-suite-completeness.unit.test.js` | C | Pins rule 10: both reporters in both scripts; under each script's flags a file ending early, or before any report, fails naming what never ran; a complete file is judged on its tests only. |
| `tests/` | `nodeSuiteScriptFixture.js` | C | Runs a throw-away test file with the exact flags of a package's `test` script (rules 5 and 10). |
| `tests/` | `disabledAcompteLinkFixture.js`, `deposit-collected-by-link-kept-on-save`, `deposit-link-paid-on-disabled-acompte`, `deposit-due-date-and-override-history`, `payment-links-converted-devis-double-payment` | T | Rule 6: dates built from today. |
| `tests/` | `reservation-overpayment`, `kept-money-priced-closes-trop-percu`, `trop-percu-refund-books`, `hourly-session-overlap`, `ledger-stored-deposit-ceiling`, `platform-paid-solde-follows-statement` | T | Rule 6: stays built from today (`inDays`). |
| `tests/` | `reservationSaveFixture.js` and its 17 suites | T | Rule 6: default stay `inDays(270)`, `inDays` exported; every suite's stays built from it. |
| `plugins/accounting-export/tests/` | `accounting-paid-then-reduced.unit.test.js` | T | Rule 6: stay built from today (test only, no plugin version bump). |
| `tests/` | `ledgerFixture.js` and its 9 suites, `clients-no-duplicate-and-draft`, `clients-duplicate-created-from-the-fiche`, `reservation-overpayment-by-poste`, `calendar-parity-superseded`, `baby-bed-line-stored-on-create`, `ical-nameless-summary-matching`, `lodgify-decommission-native-feeds`, `reservation-number-after-cancellation` | T | Rule 6 (third pass): default stay `inDays(270)`, slots `inDays(255 + 7n)`, `inDays` exported; stays, iCal feeds and paid dates built from today. |
| `plugins/accounting-export/tests/` | `stay-payment-split-fallback.unit.test.js` | T | Rule 6: weekly slots built from today (test only, no plugin version bump). |
| `scripts/` (repo root) | `check-test-dates.mjs` | C | Rule 7: names the literal dates of the test lines a PR adds; a clock pin or an injected clock exempts its own block (a helper's, the blocks that call it); `--strict` fails. Rule 9: `--known` sets aside lines already on those refs. |
| `.github/workflows/` | `unit-tests.yml` | T | Rule 7: a `spec rules` step runs the check with `--strict`; rule 9: it fetches master and inte/plugins and passes them as `--known`. Rule 8: the `client` job is a 3-shard matrix; build and bundle budget in shard 1. |
| `.github/workflows/` | `release.yml` | T | Rule 8 / self-update rule 52: `tests` split into `server-tests` and a 3-shard `client-tests`. |
| `tests/` | `test-suite-calendar-and-ci-budget.unit.test.js` | C | Pins rules 6-9 and self-update rule 52. |

### 4.2 Client side

API, data model and UI are unchanged. Rule 11 only:

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `client/` | `vitest.slow-scheduler.config.js` | C | The unit config with `src/setupSlowScheduler.js` loaded first. |
| `src/` | `setupSlowScheduler.js` | C | Delays every `setImmediate` (React's scheduler) by `SCHED_DELAY` ms, and drains the delayed ones before each file's jsdom is torn down. |
| `client/` | `package.json` | T | `test:slow-scheduler` script. |
| `src/**/__tests__/` | `VatRegimeSwitchDialog.switch`, `SupportAccessBanner.states`, `LazyPage.loading`, `UpdateAvailableAlert`, `EmailSettingsPage.identity`, `EmailSettingsPage.social-links`, `PlatformAccountsPage`, `ReconciliationPage.filters`, `TariffRecipeCard`, `TariffRecipeCard.cleaning-fee`, `TariffRecipeCard.extra-guest-config`, `TariffRecipesPage`, `SettingsGoogleCalendarSection`, `ResourcePlanningPage.stale-bookings`, `ReservationSasDialog.plugins`, `CompensationsPage` | T | Await the post-condition (tests only, no plugin version bump). |

Server side, rule 11: `tests/client-effect-race-sweep.unit.test.js` (C) pins the script, the config, the
delay, and the sweep's absence from the normal config and from every CI workflow.

## 7. Test plan

- [x] `server-test-isolation.unit.test.js`: the preload sets a temp `DB_PATH` (rule 1), refuses the default path and its `-wal` / `-shm` (rule 2), allows `:memory:` and the temp file.
- [x] Rule 4: a single file run (`settings-model`) without preload leaves `guestflow.db` / `.env.local` / `uploads` untouched; under `NODE_TEST_CONTEXT` the three defaults are in the temp dir.
- [x] Rule 3: the three tests, run alone with `server/guestflow.db` removed, leave no file behind.
- [x] Rule 5: `node-suite-test-timeout.unit.test.js` (2 tests) reads both scripts (timeouts + `--test-force-exit`) and runs a hanging file under a 300 ms limit with force-exit; passes on Node 22.22.2 and 24.22.2.
- [x] Rule 5 (amended 2026-10-30, audit R9 M-1): the same file (6 tests) reads both scripts (timeouts, the watchdog, no `--test-force-exit`) and, under each script's own flags (timeout 300 ms, grace 300 ms), runs a test that never settles and a passing test that leaves an interval open: both fail, named, in under 20 s, on Node 22.22.2 and 24.22.2. Before the change the open-handle case was green under force-exit (3 of the 4 new cases red on Node 24, all 4 on Node 22).
- [x] Rule 10: `node-suite-completeness.unit.test.js` (8 tests) — both reporters in both scripts; plain `node --test` reports a file that calls `process.exit(0)` in its second test as green with 1 test (the hole); under each script's flags the same file fails naming the 3 tests never reported, a file exiting before any report fails with « no test reported », and a complete file with a skip, a todo, a suite and a failure is judged on its tests only. 5 of the 8 were red before the change, on Node 22.22.2 and 24.22.2. Under load (two files, 20 parallel runs per batch): with `--test-force-exit` and the reporter, 6 of 40 runs truncated, all 6 failed and named; with the new flags, 60 of 60 runs complete, 91 tests each.
- [x] Rule 6: the six files carry no literal date the calendar will pass (`findDateBombs` over their whole content); with the R7 clock-shift preload they were red before the change (3 tests at 2027-05-09, 16 at 2027-06-08, 26 at 2027-10-05, rule 34 from 2027-05-10, 1 of the due-date file at 2027-09-05) and are 48/48 green at 2026-10-30 09:30Z and 23:30Z, 2027-05-09, 06-08, 09-05, 10-05, 12-31 22:30Z, 2028-02-29 and 2030-01-02.
- [x] Rule 6 (second pass): the rule 6 test also reads the eight suites above and the whole `reservationSaveFixture` family (17 suites, found by their `require`). Clock-shift sweep of those 26 files (117 tests) under Europe/Paris and America/Los_Angeles: before, 0 / 4 / 8 / 20 / 27 red at 2026-10-30, 2027-01-24, 2027-02-12, 2027-05-25, 2027-07-21; after, 117/117 at each, and at 2027-10-05, 2028-02-29 and 2030-01-02.
- [x] Rule 7: `test-suite-calendar-and-ci-budget.unit.test.js` — a quoted date, a template opening on a year and a `Date.UTC` year are named with file and line; only added lines are read, numbered as the diff numbers them; the marker, a pinned clock, a comment, the far future and non-test files are not named; a timer mock without `'Date'` pins nothing and `mock.timers.enable()` with no `apis` does; a pin exempts its own `test` / `describe` only, and a call written in a string is not a pin; the PR job runs it with `--strict`. The five new cases fail on the previous script and workflow. The PR itself passes `--strict` against inte/plugins.
- [x] Rule 6 (third pass): the rule 6 test also reads the eight files of the second review, `ledgerFixture.js` and its 9 suites (found by their `require`). Those 17 files (188 tests) green at today, 2027-03-11 and 2027-07-21; whole-suite sweep below.
- [x] Rule 7 (injected clocks, review of 2026-10-30): a replaced `getTodayIsoDate` / `todayIso`, a `NOW` constant and a `now:` exempt their block, the real clock and a local `const todayIso` helper do not; a pin in a named helper covers it and its callers; a `test.each` callback holds its own pin; a top-level `test.beforeEach` pins the file; `useFakeTimers({ toFake: ['setTimeout'], now })` pins nothing. Both new cases fail on the previous script.
- [x] Rule 9: `dropKnownLines` keeps a line absent from the known content of its own file; a real git repository replays an integration PR (exit 0 with `--known`, exit 1 when the known ref does not resolve) and a feature PR adding one new line on top of a known one (only the new line named); the workflow fetches both branches and passes them. The three fail on the previous script and workflow. Replayed on the real branches: inte/plugins → master 2 091 named lines → 0, master → inte 25 → 0; this PR passes against inte/plugins.
- [x] Rule 8: the same file reads the `client` job (3 shards, `fail-fast: false`, budget in shard 1) and the release jobs (self-update rule 52). The three shards locally: 209 / 208 / 208 files, 1 026 + 1 029 + 1 033 = 3 088 tests, the full suite's count.
- [x] Rule 11: `client-effect-race-sweep.unit.test.js` (3 tests) — the script and config, the setup's delay (8 ms by default, `SCHED_DELAY` otherwise), and its absence from `vitest.config.js` and from every `.github/workflows/*.yml`; the first 2 red on inte/plugins at 611baf15. Whole client suite under `npm run test:slow-scheduler`: 10 / 11 failures at 2 / 8 ms before, 0 at both after; the normal suite stays 3 131 tests. `SupportAccessBanner.states.test.jsx` rule 17: its absence check, anchored by an `act` on the answer, fails when the answer carries a pending request.

## 8. Out of scope

- E2E runs write `server/.env.local` through `instancePaths`; that is a separate, by-design path.
