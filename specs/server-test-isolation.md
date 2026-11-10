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
because the runner is busy (rule 11). A server test does not change outcome with the GuestFlow flags the developer's shell
exports, nor with the app's other variables it carries (rule 12), and a variable the app reads without
being on the preload's lists fails the run once the suite executes the read (rule 13).

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
   **Reading of 2026-11-03 (audit R21-S3, S4).** A clock coherent across `Date` and SQLite's own « now » removes the
   « mixed clock » noise above, and two kinds of test it was hiding went red. A test that stores `datetime('now')` and
   compares with the local month misses it in the first hour of a month (`reservation-number-after-cancellation`,
   `reservation-number-repair-shown-until-checked`): it stores `datetime('now', 'localtime')`. And a row whose
   `createdAt` falls to the column's default reads the real clock even under a frozen `Date` (`vat-regime-preview`,
   whose golden fixture freezes `Date` at its own calendar): that row names its `createdAt`. The stays of
   `devis-price-lock`, `devis-pdf-quote-parity` and `payment-link-quote-parity` (`2030-07-10`) now use `FAR_YEAR`. The rule 6
   test reads whichever of its files the tree ships, so a removed plugin takes its tests with it
   ([plugin-removal-resilience.md](plugin-removal-resilience.md) rule 19).
   **Reading of 2026-11-05 (audit R24-S2).** A date built from today can still hang on the day of the month. Two tax
   suites did: `platform-added-guests-tourist-tax-books` placed its stay on days 1 to 3 of the current month, which D16
   (« declarable once the stay is over ») refused to tick on the 1st, 2nd and 3rd; `platform-added-guests-stamp-grown`
   placed its stays 30 + 7n days out and read the page of their end month, empty when a stay ended on the 1st. The first
   now lives in the previous month (its own row collected today is read on today's month, rule 12 of
   platform-added-guests-tourist-tax), the second from the 5th of the month after next, 3 days apart, all its nights in
   one month. Proof, no guard added: with a clock coherent across `Date` and SQLite, both files are green on the 1st, the
   3rd, the 9th and the last day of 2026-11, 2026-12, 2027-01, 2027-02, 2027-03, 2027-10 and 2028-02, at 09:00Z and
   22:30Z (56 runs), and on 62 consecutive days from 2026-11-05; red before on 2026-11-09 (1), 2026-12-01 and 2026-12-03
   (5). The 274 server files that read the tourist tax are green on the same 56 runs.

7. **A PR adding a literal date to a test is told so, on the line** (added 2026-10-30, audit R8 M-1, the guard
   audit R7 proposed). `scripts/check-test-dates.mjs --base <ref>` reads only the test lines a PR adds (files of
   a `tests/`, `__tests__/` or `e2e/` folder, and every `*.test.*` / `*.spec.*`), and names a quoted
   `YYYY-MM-DD`, a quoted iCal `YYYYMMDD` (alone or opening a `…T090000Z` timestamp), a template opening on a year (`` `2028-${m}-10` ``), or a `Date.UTC(YYYY, …)` /
   `new Date(YYYY, …)` year, from the date window's start — today − 5 years, a 29 February landing on the 28th,
   `horizonStart` of `utils/stayDates.js` — to ten years out (amended 2026-11-03, reading below). Not named:
   comment lines; an impossible day (`2026-02-30`), refused whatever today is; a line carrying
   `date-literal-ok`, or under one (« `// date-literal-ok: <why>` », for a date nothing compares with today,
   such as the input of a pure function or a « now » the test hands to it, or a row the test seeds straight
   into the database); the lines of a test that pins the clock; and a date further out, a deliberate far
   future (`2099-06-01`). A pin is
   `vi.setSystemTime(`, `mock.timers.setTime(`, `vi.useFakeTimers({ now })` whose `toFake` (when given)
   includes `'Date'`, or `mock.timers.enable(` whose `apis` include `'Date'` or are left out —
   `{ apis: ['setTimeout'] }` or `toFake: ['setTimeout']` leaves `Date` real and pins nothing. A clock the test
   only injects — a replaced `getTodayIsoDate` / `todayIso`, a `NOW` constant, a `now:` handed to the code — is
   no pin (withdrawn 2026-11-03, reading below; it was one from the review of 2026-10-30). A pin inside a `test` / `it` / `describe` call, a
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
   **Reading of 2026-11-03 (audit R20-S2).** The guard's premise, « a date already in the past cannot be
   passed again », stopped holding on 2026-11-02: every date entered on a write path now lies within
   [today − 5 years, today + 5 years] (specs/reservations-backend-mvc.md rule 13, second reading), so a past
   literal a test sends to a write path is refused once it is more than five years old. A clock-shift run of
   the whole server suite at 2031-11-03, once with the five-year window and once with it widened to 50 years,
   found 136 tests in 43 files red for the window alone (the first on 2031-01-02, `email-manual-queue`'s
   `query: { today: '2026-01-01' }`), plus `PeriodSelector.test.jsx` on the client; and the guard let a new
   one in that day (`balancePaidDate: '2026-10-12'` was not named, `'2026-12-12'` was). The guard now names the
   past side down to the window's start, read from `horizonStart` itself so the two never drift apart. An
   injected « now » no longer exempts anything: it pins the function it is handed to, while the window reads
   the real clock (`todayIso()`, `Date`), so a date such a test sends to a write path expires all the same —
   the reconciliation suites injected `todayIso: () => '2026-10-23'` and marked bank credits received on
   their October 2026 dates. A date handed only to the function the clock is injected into takes the marker.
   Only the clock pins (`mock.timers`, `vi.setSystemTime`) still exempt their block: they move the window too.
   The 136 tests and the client file now hang on today (rule 6): `inDays(n)` keeps each date at the distance
   from today it had on 2026-11-03; a journal month is the month of the paid date; a printed day is built from
   the same date, with the year the ledger shows (rule 4 of reservation-payment-ledger); the laundry suite
   keeps its Thursday and its Tuesdays; the reconciliation fixture's `TODAY` is the real day, its suites'
   dates `dayAt(n)` from it, and `frShort` prints their « jj/mm »; `calendar-parity-superseded`'s
   calendar-year fixture lies in last year. The rule 6 test reads all of them, whole (`R20_SWEEP`). In the
   same pass the four suites that read « today » as the UTC day (`new Date().toISOString().slice(0, 10)`)
   read the server's local day: `stored-split-only-with-contribs` failed every night between 00:00 and
   01:00 / 02:00 in Paris, its payment dated the day before the stay was created (audit R20-S1); the others
   (`establishment-closures-bounds`, `devis-model-createdAt-validUntil`, `reservation-ledger-parity`) only
   held by their margins.

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
   *Reading of 2026-11-06 (audit R26-S1):* the probe child of these cases runs under a 15 s `--test-timeout`, as
   `node-suite-test-timeout`'s settling case and `server-test-env-trace` do. Under process isolation that timeout also
   covers the child's boot (node and the three preloads), and the 300 ms of `runLikeSuite`'s default, meant for rule 5's
   « never settles » cases, was spent on booting alone on a loaded runner: « test timed out after 300ms » on a complete
   file. Replayed with a child boot slowed by 500 ms: 6 of 8 red before, 8 of 8 green after. Rule 5's cases keep 300 ms.

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

12. **A test process starts without the shell's GuestFlow flags** (added 2026-11-01, review of PR #919). The
   `npm test` preload (`src/tests/setup/isolateDefaultDb.js`) deletes every `GUESTFLOW_*` variable from
   `process.env` before anything loads, except the runner's own `GUESTFLOW_TEST_*` knobs (rule 5's
   `GUESTFLOW_TEST_EXIT_GRACE_MS`). A test that needs a flag sets it inline or passes its own `env`, as the
   suites already do. Why: tests reading `process.env` through a default (`pluginGovernance.operatorManaged`,
   the managed-licence reader, `runVersionCheck`, `selfUpdateSupported`) followed the developer's shell: under
   `GUESTFLOW_MANAGED=1` the full suite had 50 failures in 19 files (plugin lists without `actions` or
   `state`, public website-booking endpoints answering 503), and the E2E `GUESTFLOW_DISABLE_OUTBOUND=1` could
   make a test pass without running what it checks. CI never sets them, so only a local run went wrong. After
   the change the full suite is green in a clean shell and under each of `GUESTFLOW_MANAGED=1`,
   `GUESTFLOW_DISABLE_OUTBOUND=1 NODE_ENV=test` and `GUESTFLOW_SELF_UPDATE=off` (9 242 / 9 242 in each of the four runs). The app keeps its
   flags: `database.js` and `utils/instancePaths.js` (rule 4) strip nothing, and the E2E servers, which set
   `GUESTFLOW_DISABLE_OUTBOUND=1` on purpose, start `node src/index.js` without the preload. Test:
   `server-test-ambient-flags.unit.test.js`.

   *Reading of 2026-11-01 (audit R13 L-1):* « the shell's GuestFlow flags » covers the app's whole
   configuration, not only the `GUESTFLOW_` prefix. The preload also deletes, by name, every other variable
   the server reads (`PUBLIC_SITE_ORIGIN`, the `*_RATELIMIT_*` knobs, `QONTO_*`, `VAPID_*`, `TLS_*`, `PORT`,
   `TRUST_PROXY_HOPS`, `GITHUB_SHA`, `SKIP_MIGRATIONS`…), and a `NODE_ENV` other than `test`, so a shell in
   `production` or `development` runs the suite as CI does (CI sets none). It keeps what the runner needs:
   `PATH`, `TZ` (a clock sweep sets it on purpose), `NODE_TEST_CONTEXT`, `NODE_ENV=test`, the runner's
   `GUESTFLOW_TEST_*` knobs; `DB_PATH`, `PERSISTENT_DB` and `TMPDIR` are then replaced or deleted by rules
   1 and 4. The list lives in one place, `src/tests/setup/appEnvNames.js` (`APP_ENV_NAMES` stripped,
   `RUNNER_ENV_NAMES` kept), and a guard test derives the app's reads from `src/` outside `tests/`
   (`process.env.X`, `env.X` on an injected env, `env['X']`, and the secrets `localEnv` reads back by name):
   a name on neither list fails, so does a listed name `src/` no longer reads, a destructured
   `process.env`, or a new reader of a name built at run time (only `localEnv.js` and `updateStaging.js`
   do it, for names the scan already covers or proxy settings). Why: a shell exporting the production
   `PUBLIC_SITE_ORIGIN` or `PUBLIC_API_RATELIMIT_MAX=5` failed 4 tests in 3 files (`qonto-config` rule 2,
   the GVR landing URL, website-booking `roostview-key-mounted` rule 6 answering 429). Test:
   `server-test-app-env.unit.test.js`.

   *Reading of 2026-11-01, review of #920:* the guard of the reading above sees a name only when it is
   written next to `env`, and ordinary syntax got past it (`process.env?.X`, `const e = process.env`,
   `(cfg = process.env) => cfg.X`, `env[K]` on an injected env, a backtick key, `Reflect.get`, a lowercase
   name). Its description is replaced by this one. A name is read as `process.env.X`, `env.X` or
   `env['X']`, with or without `?.`, in any case (pm2's `pm_id`, which `processRestart` reads to tell it is
   supervised, is now on `APP_ENV_NAMES`), on `process.env` or on any `env` (bare or `opts.env`, never the
   `env.local` of a file name). Everything else that reaches the environment is an indirect access:
   `process.env` not bound to an identifier named `env` (an alias, a destructuring, an argument, a
   `Reflect.*` call), `env[…]` with a key that is not a quoted literal, `process[…]` or `= process`, a
   `Reflect.*` call on an `env`, and an `env: other` rename. Comments do not count. An indirect access fails
   the guard unless its file is listed with its exact count in `INDIRECT_READERS`, each entry checked by
   hand: `process.env` passed to a parameter named `env` (`settingsController`, `index.js`,
   `accountSecurityServices`, `plugins/host`), `qontoSettingsController` handing `env: vars` on as `env`,
   `localEnv` and `testOnlyKeys` over names the scan covers, `updateStaging` over the proxy settings. A
   new indirect access, even in a listed file, fails until it is read by name or listed with its reason. A
   test writes each bypass form to a scratch directory and checks the guard fails on it, and another that
   the forms `src/` uses on purpose (`env = process.env`, `config.env || process.env`, `'.env.local'`)
   stay quiet. Test: `server-test-app-env.unit.test.js`.

   *Reading of 2026-11-02 (audit R14 L-1):* the reading above lets `process.env` be bound to an identifier
   named `env` because the scan « then sees » its reads, but it saw only `env.X` and `env['X']`: an `env`
   taken whole got past it (`const { X } = env`, `'X' in env`, `{ ...env }`, `Object.keys(env)`, `read(env)`),
   and so did `require('process').env`. Since the injected `env = process.env` default is the project's
   standard pattern, `const { NEW_KNOB } = env` was the likeliest way to add an unlisted reader. Now
   `require('process')` and `require('node:process')` read as `process`, and an `env` other than
   `process.env` (bare or `opts.env`) is an indirect access when it is destructured, the right side of `in`,
   spread, aliased (`const e = env`; rebinding to `env` stays allowed), or a call argument. A call argument is
   allowed only when a function of `src/` with the callee's name declares a parameter named `env` at that
   position (`shouldEnforceHttps(env)`, `bestCandidate`, `bestRefusal`…): the callee's reads are then scanned
   by name (`rangeRefusal` destructures its context, so its three calls are among the pins below). An `env`
   in a parameter list, a condition, an object or an array is no argument. The files whose `env` is no process
   environment are pinned with that reason (`plugins/loader` and `pluginOffers`, the plugin-range context;
   the Neat plugin, its `'production'` / `'staging'` environment), as is `localEnv`'s `{ ...env }` copy for the
   self-update child and `qontoSettingsController`'s `vars = env` default. The test that writes the bypass
   forms now writes 28 (12 new), and its title says « each probed form », which is what it checks. Test:
   `server-test-app-env.unit.test.js`.

   *Reading of 2026-11-02 (review of #924):* the reading above still let through an alias with a fallback
   (`const e = env || {}`, `env ?? {}`), an `env` that leaves its function whole (`const get = (env) => env;
   get().X`, `return env`, `({ env })` read as `f().env.X`), and a call argument whose callee merely shares a
   name with some function of `src/` declaring `env` there (`const config = (cfg) => cfg.X; config(env)`). Now
   the alias pattern also ends on `||` and `??`; `return env` and `=> env` are indirect accesses, and
   `f().env.X` / `a[0].env.X` are read by name; and a call argument is judged by the callee the call reaches:
   `mod.f(` and `require(spec).f(` by the `f` of that module of `src/`, otherwise by the `f` the file declares
   (local wins), else by the one it imports by name from a module of `src/`, following a re-export. A package
   callee, or a method of an object the scan cannot follow, leaves the argument indirect. The R14 patterns and
   these ones match on the code with its strings blanked, so `'not set in env'` is no access. The guard is a
   grep guard and fails open in one case: when bracket pairing breaks (a `(` or `[` inside a regex literal or
   a nested template), an `env` whose call it cannot find is allowed, as is, by design, an `env` inside `[...]`
   or `{ cfg: env }`. The names only a plugin reads are keyed by plugin id in `PLUGIN_ENV_NAMES` (still all
   stripped); with the plugin removed they are not called stale, so the removal matrix (`plugin-removal.yml`,
   which runs the full server suite per removed plugin, specs/plugin-removal-resilience.md rules 7(a) and 19)
   stays green on this file, and a test fails when a name only a shipped plugin reads is not keyed by it, or a
   keyed name is not read under `src/plugins/<id>/`. Test: `server-test-app-env.unit.test.js`.

   *Reading of 2026-11-02 (audit R15 L-1):* the reading above says the guard « fails open in one case »; that
   claim is withdrawn, it was not true. The guard is a heuristic over the source text, not a parser: it fails on
   each form listed in `PROBES` of `server-test-app-env.unit.test.js`, and only those are promised. The audit got
   three more past it: an `env` as a ternary branch (`const e = x ? env : {}`), `process` handed whole to a call
   (`read(process)`, the callee destructuring `{ env: { X } }`), and a call whose callee's name a nested function
   also declares with `env` there (`function outer() { const read = (env) => …; }` beside a top-level
   `const read = (cfg) => …`). Now an `env` after the `?` of a ternary, or after a `:` that closes a ternary's
   first branch (walking back at the same bracket depth meets a `?` before a `,`, a `;` or an opening bracket,
   so `{ value: env }` stays quiet), is an indirect access; so is `process` as a call argument; and a call
   argument is judged by the declaration of the innermost block around the call that declares the callee's
   name, a call from another file by the top-level one (by every declaration of that name when neither exists). Since
   the review of #927, an `env` as the right operand of `||` or `&&`, or awaited (`x || env`, `x && env`,
   `read(o || env)`, `await env`), is an indirect access too; `x ?? env` was already caught by the ternary
   pattern. On `src/` none of these adds a hit or a pin. Knowingly
   not caught: an `env` stored in an array or as an object value (`[env][0].X`, `{ cfg: env }`); an `env`
   reached as a property of a call's result and handed on (`read(f().env)`); `process` reached through
   `globalThis` (`read(globalThis.process)`) or through a ternary and then handed on or destructured
   (`read((x ? process : null).env)`, `const p = x ? process : {}` then `const { env: { X } } = p`); the
   arguments object (`arguments[0].X` in a function declaring `env`); an `env`
   whose call the scan cannot find because bracket pairing broke (a `(` or `[` inside a regex literal or a
   nested template); a callee whose name no block around the call declares (a method of an object literal, a
   function of a sibling block), still judged by every declaration of that name in the file; a callee whose
   name a sibling method declares, because object-literal and class bodies count as blocks, so a sibling
   method shadows a top-level callee of its name (`const read = (cfg) => …` beside `{ read(env) {…}, go(env)
   { return read(env); } }` stays quiet); and any form no probe names. A new bypass is fixed by adding its
   probe first. Test: `server-test-app-env.unit.test.js`.

13. **The suite traces what the app reads from the environment** (added 2026-11-02, review of #927, option 2
   of its « durable alternative »). Rule 12's guard reads `src/` with patterns, and five readings in a row
   found a syntax it had no pattern for; its reading of audit R15 L-1 lists the forms it knowingly does not
   catch (`[env][0].X`, `{ cfg: env }`, `read(f().env)`, `read(globalThis.process)`, `arguments[0].X`, an `env`
   whose call a broken bracket pairing hides). This rule is its runtime complement: it sees those forms too,
   but only on the code the suite runs against the real `process.env` (see what it does not see, below). Under
   `npm test` the preload (`src/tests/setup/envTrace.js`, called from
   `isolateDefaultDb.js`) replaces `process.env` in every test process with a `Proxy` over it that records
   each string key read through `get`, `has` or `getOwnPropertyDescriptor`, and each `ownKeys` (the
   environment taken whole: a spread, `Object.keys`, `JSON.stringify`, a child spawned without `env`). A
   record is attributed to the first stack frame outside the tracer: it counts only when that frame is a file
   of `server/src/` outside any `tests` or `node_modules` folder, so the reads of a test, of a package, of a
   `node -e` script, and the key reads Node makes on the app's behalf (`FORCE_COLOR` for a `console.log`,
   undici's knobs for a `fetch`, a `require`) are not the app's; a whole take walks past Node's frames, so
   `spawn` without `env` is the caller's take. The names a whole take reads on its own line belong to it. Two
   functions read names no list can hold, by design, and are granted them in `READ_BY_DESIGN`, the runtime
   twin of rule 12's pins: `updateStaging.installEnv` (the proxy settings and `NODE_EXTRA_CA_CERTS` handed to
   the npm child) and `localEnv.loadLocalEnv` (the names the process's own `.env.local` holds). Each test
   process writes what it saw to a directory the runner's process created and handed on in
   `GUESTFLOW_TEST_ENV_TRACE_DIR` (a runner knob, kept by rule 12), even when it saw nothing. At exit the
   runner merges the files; it fails the run (exit code 1) when `src/` read a name that is on neither list of
   `appEnvNames.js` (`APP_ENV_NAMES`, `RUNNER_ENV_NAMES`, the `GUESTFLOW_*` prefix but `GUESTFLOW_TEST_*`),
   naming each one with its `file:line` and the test files it ran under, or when no test process wrote
   anything; and it prints, green or red, the `src/` lines that took the environment whole (today
   `plugins/host.js`, `plugins/packageStore.js`, `utils/localEnv.js`, `utils/updateStaging.js`). The CI
   `server` job and the release's `server-tests` run `npm test`, so they run it.
   Writes (string coercion), deletes, `in`, a child process inheriting or given `env`, a `TZ` change and
   `loadLocalEnv` behave as without the proxy. It is off outside `node --test` with the preload: a process
   outside the runner, or a runner without isolation (`--test-isolation=none` or `--test-isolation none`, and
   both spellings under the `--experimental-` name; the last one given wins), makes no directory and clears
   the variable, and a test process without the variable installs nothing. A structured clone of
   `process.env` (`structuredClone`, `postMessage`, `workerData`, an IPC channel with `serialization:
   'advanced'`) throws under the trace; `src/` and the tests make none. A test file that crashes at load
   writes no trace file; the run already fails on that file. Cost measured on the full suite
   (9 282 tests, 1 212 traced processes): 343 s against 341 s without it. What it does not see, so it adds to rule 12's guard and
   replaces none of it: a read on a code path no test runs; a read through a copy of the environment
   (`const e = { ...process.env }; e.X`, `JSON.parse(JSON.stringify(process.env)).X`), where only the whole
   take that made the copy is recorded, so the printed whole-take lines mark where such copies start
   (`plugins/host.js`'s `ensure()` hands `init()` a spread copy, so the `env` readers it reaches,
   `createRestarter` and `resolveMode` among them, are untraced on that path); and a function that the tests
   only call with an injected `env` stand-in (the `fn({ env = process.env })` pattern), traced only when some
   test calls it with the default. Shown on a scratch copy
   of the tree with `const [holder] = [env]; void holder.PLANTED_UNLISTED_KNOB;` planted in
   `resolveQontoConfig`: rule 12's guard stayed green (30 / 30 tests), the run failed naming
   `PLANTED_UNLISTED_KNOB, read at utils/qonto/qontoConfig.js:66`, through the `node -e` child of
   `server-test-app-env.unit.test.js` that calls `resolveQontoConfig` with the real environment: the Qonto
   suites inject theirs, and stay green on such a plant. Test: `server-test-env-trace.unit.test.js`.

14. **No test reaches a real Qonto host** (added 2026-11-05, audit R23). An auditor's probe reached the real Qonto API
   with a made-up token, because a stored environment outranked its `QONTO_API_BASE`
   (`qonto-settings-in-app.md` rule 5 now lets a fake win). `tests/setup/realQontoGuard.js`, preloaded by the
   server's `isolateDefaultDb.js` and by the console's `test` script, refuses `*.qonto.com` and `*.qonto.co` in
   `dns.lookup` and `fetch` before any socket opens, and fails the process at exit even when the code under test
   swallows the error, since most Qonto callers do. Child processes do not inherit a preload: `inputShapeApp`, the shadow
   and every E2E server pin both bases to a dead local port (`e2e-playwright-smoke-suite.md` rule 23). The client suites
   have no Qonto call to make. Test: `test-preload-real-qonto-guard.unit.test.js`.

15. **`npm test`'s `--test-timeout` also caps each file** (added 2026-11-10, audit R36-S4). With one process per file the
   runner cuts a whole file at 60 s, whatever a test's own `{ timeout }` says: the per-field fuzz (`input-shape-per-field`,
   38 to 42 s on CI and cut at 60 s on a loaded machine, its app child left running) had a dead 300 000 ms option. A
   file holds what runs well under the cap: the fuzz is split by route prefix (`tests/inputShapePerField.js`): the stays,
   their money and their logements in `input-shape-per-field`, every other route in `input-shape-per-field-others`, each
   row in exactly one file. No test sets a timeout above the cap.

16. **A client test that walks a dialog through several server answers sets its own timeout** (added 2026-11-10, audit
   R36-S3). Vitest's 5 s default is not a budget on a loaded runner: a ResourceBookingDialog test failed CI at 5 073 ms.
   The hourly-resources dialog suites of #1002 (`ResourceBookingDialog.created-id`, `.payment-refused`,
   `.paid-actions`, `ResourceArrivalDialog.paid-before`, `.no-unasked-invoice`) and `ClientsPage.stale-impact` give each
   test 15 000 ms, as 24 client files already did; `ResourceArrivalDialog`'s offered-time case waits for the new total
   before clicking (rule 11). The per-test 15 000 ms of these files gave way to rule 17's suite budget (2026-11-10,
   verification R36b).

17. **The client suites share one budget on a loaded runner** (added 2026-11-10, verification R36b). Per-test timeouts
   did not reach the cause: at load 55 to 66 other dialog suites (`ResourceBookingDialog.stale-slots`, `.preview`,
   `ResourcePlanningPage.stale-bookings`) still hit Vitest's 5 s default, a `findBy` failed at Testing Library's 1 s, and
   `created-id` took 16,5 s and 17,8 s against its own 15 s. `client/vitest.config.js` sets `testTimeout: 30000` for
   every test and `client/src/setupTests.js` sets `configure({ asyncUtilTimeout: 5000 })` for every `findBy*` /
   `waitFor`; a test's explicit `{ timeout }` still wins. The rule-16 files no longer carry a per-test timeout. Older
   files that set 30 s themselves are left as they are (equal to the budget). The guest-app web apps' own Vitest
   configs are outside this rule (their plugin is not changed here).

**Edge cases:**
- A targeted `node --test <file>` used to open and migrate `server/guestflow.db` for 389 test files (audit R2,
  2026-10-29); rule 4 closes that. Rule 3 stays as the explicit guard of the three first offenders.
- Only a process outside the test runner (e.g. `node -e`) opens the default path. `node --test --experimental-test-isolation=none`
  runs the files in the parent process, where `NODE_TEST_CONTEXT` is not set: that mode is isolated only with the
  preload (`npm test` never uses it). A process with `NODE_ENV=production` is never isolated, even under the runner.
- A single file run without the preload (`node --test <file>`) still reads the shell's `GUESTFLOW_*` flags
  and the other app variables: rule 12 lives in the preload only, so `npm test` is the hermetic entry point.
- A single file run with the preload (`node --test --require ./src/tests/setup/isolateDefaultDb.js <file>`) is
  traced too (rule 13): its runner checks what that file's code paths read.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `tests/setup/` | `isolateDefaultDb.js` | C | Preload: temp `DB_PATH` / `.env.local` / uploads per process + guard on the default path. |
| `utils/` | `testProcessIsolation.js` | T | Rule 4: same isolation for a process run without the preload. |
| `database.js`, `utils/instancePaths.js` | | T | Call it before reading the environment. |
| `tests/` | `server-test-isolation.unit.test.js` | C | Pins rules 1-2 in a child process. |
| `tests/setup/` | `isolateDefaultDb.js` | T | Rule 12: deletes every `GUESTFLOW_*` variable but `GUESTFLOW_TEST_*` at start-up; since 2026-11-01 through `appEnvNames.stripAppEnv`, which also deletes the app's other variables. |
| `tests/` | `server-test-ambient-flags.unit.test.js` | C | Pins rule 12: flags dropped under the preload, an inline flag still read, the app modules strip nothing, no E2E launcher loads the preload; since rule 13, `GUESTFLOW_TEST_ENV_TRACE_DIR` is set by the runner, like the isolation paths, so it is left out of the flags compared. |
| `tests/setup/` | `appEnvNames.js` | C | Rule 12 (reading of 2026-11-01): `APP_ENV_NAMES` the preload deletes, `RUNNER_ENV_NAMES` it keeps, and `stripAppEnv`, which the preload calls; since the review of #924, `PLUGIN_ENV_NAMES`, the names only a plugin reads, by plugin id (all in `APP_ENV_NAMES`). |
| `tests/` | `server-test-app-env.unit.test.js` | C | Pins the reading: the app variables dropped and the runner's kept under the preload, `NODE_ENV` kept only as `test`, `resolveQontoConfig` no longer follows the shell, and the grep guard that keeps the list equal to what `src/` reads; since the review of #920, the guard's indirect accesses pinned by file in `INDIRECT_READERS`, the bypass probes, and `pm_id` stripped; since audit R14 L-1, an `env` taken whole (destructured, `in`, spread, aliased, or handed to a call whose callee does not declare `env` there) and `require('process')`; since the review of #924, `env || …` / `env ?? …` aliases, `return env` / `=> env`, a call argument judged by the callee the call reaches, and the plugin-keyed names; since audit R15 L-1, an `env` as a ternary branch, `process` handed whole to a call, and a callee resolved to the innermost declaration in sight; since the review of #927, an `env` after `||` / `&&` or awaited. |
| `tests/setup/` | `envTrace.js` | C | Rule 13: in the runner, the trace directory and the exit check; in each test process, the `process.env` Proxy and its attribution to `src/` lines; `collect` / `report` merge the processes' files. |
| `tests/setup/` | `isolateDefaultDb.js` | T | Rule 13: calls `envTrace.start()` before `isolate`, whose exit handler removes the runner's temp dir. |
| `tests/` | `server-test-env-trace.unit.test.js` | C | Pins rule 13: the forms recorded and those left out, the report, unchanged behaviour under the proxy, and the trace on under the `npm test` flags only. Since the review of #928, every spelling of a runner without isolation. |
| `tests/setup/` | `realQontoGuard.js` | C | Rule 14: `dns.lookup` and `fetch` refuse a real Qonto host, and an attempt fails the process at exit. |
| `tests/setup/` | `isolateDefaultDb.js` | T | Rule 14: loads the guard. |
| `tests/` | `test-preload-real-qonto-guard.unit.test.js` | C | Pins rule 14 in child processes that never get past the guard. |
| `tests/`, `plugins/hourly-resources/tests/` | the three offenders | T | Rule 3. |
| `package.json` | `test` script | T | `--require ./src/tests/setup/isolateDefaultDb.js`; `--test-timeout=60000` and the exit watchdog (rule 5); the `spec` and completeness reporters (rule 10). |
| `control-plane/server/package.json` | `test` script | T | `--test-timeout=180000` and the exit watchdog (rule 5); the `spec` and completeness reporters (rule 10); `--require` of the Qonto guard (rule 14). |
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
| `scripts/` (repo root) | `check-test-dates.mjs` | C | Rule 7: names the literal dates of the test lines a PR adds, from `horizonStart` (today − 5 years) to ten years out; a clock pin exempts its own block (a helper's, the blocks that call it), an injected clock does not; `--strict` fails. Rule 9: `--known` sets aside lines already on those refs. |
| `.github/workflows/` | `unit-tests.yml` | T | Rule 7: a `spec rules` step runs the check with `--strict`; rule 9: it fetches master and inte/plugins and passes them as `--known`. Rule 8: the `client` job is a 3-shard matrix; build and bundle budget in shard 1. |
| `.github/workflows/` | `release.yml` | T | Rule 8 / self-update rule 52: `tests` split into `server-tests` and a 3-shard `client-tests`. |
| `tests/` | `test-suite-calendar-and-ci-budget.unit.test.js` | C | Pins rules 6-9 and self-update rule 52. |

### 4.2 Client side

API, data model and UI are unchanged. Rules 11 and 17 only:

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `client/` | `vitest.slow-scheduler.config.js` | C | The unit config with `src/setupSlowScheduler.js` loaded first. |
| `src/` | `setupSlowScheduler.js` | C | Delays every `setImmediate` (React's scheduler) by `SCHED_DELAY` ms, and drains the delayed ones before each file's jsdom is torn down. |
| `client/` | `package.json` | T | `test:slow-scheduler` script. |
| `client/` | `vitest.config.js` | T | Rule 17: `testTimeout: 30000` for every test. |
| `src/` | `setupTests.js` | T | Rule 17: `configure({ asyncUtilTimeout: 5000 })` for every `findBy*` / `waitFor`. |
| `src/**/__tests__/` | the rule-16 files | T | Rule 17: per-test timeouts dropped (tests only, no plugin version bump). |
| `src/**/__tests__/` | `VatRegimeSwitchDialog.switch`, `SupportAccessBanner.states`, `LazyPage.loading`, `UpdateAvailableAlert`, `EmailSettingsPage.identity`, `EmailSettingsPage.social-links`, `PlatformAccountsPage`, `ReconciliationPage.filters`, `TariffRecipeCard`, `TariffRecipeCard.cleaning-fee`, `TariffRecipeCard.extra-guest-config`, `TariffRecipesPage`, `SettingsGoogleCalendarSection`, `ResourcePlanningPage.stale-bookings`, `ReservationSasDialog.plugins`, `CompensationsPage` | T | Await the post-condition (tests only, no plugin version bump). |

Server side, rule 11: `tests/client-effect-race-sweep.unit.test.js` (C) pins the script, the config, the
delay, and the sweep's absence from the normal config and from every CI workflow.
Server side, rule 17: `tests/client-test-budget.unit.test.js` (C) pins the two budgets and the rule-16 files'
dropped timeouts.

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
- [x] Rule 12: `server-test-ambient-flags.unit.test.js` (4 tests) — under the preload a shell carrying `GUESTFLOW_MANAGED`, `GUESTFLOW_DISABLE_OUTBOUND`, `GUESTFLOW_SELF_UPDATE`, `GUESTFLOW_PLUGINS` and `GUESTFLOW_ICAL_ALLOW_PRIVATE` leaves only `GUESTFLOW_TEST_EXIT_GRACE_MS`; `operatorManaged()` is false until the test sets the flag inline; `database.js` and `instancePaths` keep the flags; the six Playwright configs and E2E launchers, the app modules and `npm start` never name the preload. The first 2 red before the change. Full `npm test`: 9 242 tests, 0 failures in a clean shell and under each of the three flags (before: 50 failures under `GUESTFLOW_MANAGED=1`).
- [x] Rule 12, reading of 2026-11-01 (audit R13 L-1): `server-test-app-env.unit.test.js` (5 tests) — under the preload a shell carrying the audit's variables (`PUBLIC_SITE_ORIGIN`, three `*_RATELIMIT_MAX`, `TRUST_PROXY_HOPS`, `PUBLIC_API_KEY`, `QONTO_ENV`, `GATE_API_KEY`) and a sample of the others (`QONTO_API_BASE`, `VAPID_PUBLIC_KEY`, `TLS_CERT_PATH`, `PAYMENT_POLL_TICK_MINUTES`, `GITHUB_SHA`, `PORT`) leaves none of them, keeps `TZ`, `PATH`, `NODE_ENV=test` and `GUESTFLOW_TEST_EXIT_GRACE_MS`; `NODE_ENV=production` and `development` are dropped; `resolveQontoConfig` resolves no origin and the sandbox until the test sets the variable inline; the grep guard finds every name `src/` reads on one of the two lists and no stale entry (a probe file reading `process.env.NEW_SHELL_KNOB` made it fail, naming the file); the whole `APP_ENV_NAMES` list exported is gone under the preload. 4 red before the change: the grep guard (test 4) checks the list against `src/`, not the preload, so it was green on the previous preload and pins the list. The audit's repro (3 files, `PUBLIC_SITE_ORIGIN` + `PUBLIC_API_RATELIMIT_MAX=5`): 4 failures with the previous preload, 0 after. Full `npm test`: 9 247 tests, 0 failures in a clean shell, under the audit's variable set with `NODE_ENV=development`, and under every `APP_ENV_NAMES` variable exported with `NODE_ENV=production GUESTFLOW_MANAGED=1 GUESTFLOW_DISABLE_OUTBOUND=1`.
- [x] Rule 12, reading of 2026-11-01, review of #920: `server-test-app-env.unit.test.js` now 8 tests (+3). The probe test writes 16 bypass forms and a plain `process.env.X` read to a scratch directory, one file each; the first guard let 15 of the 16 through (it caught only `const { X } = process.env`), the hardened one fails on all 17. The same 16 dropped one by one into `src/utils/` turn the guard red; so does a backtick-keyed `process.env[…]` appended to `localEnv.js`, a listed file. The quiet-forms test pins no false alarm on `env = process.env`, `config.env || process.env`, `env?.X` and `'.env.local'`. The pm2 test (`pm_id=0` in the shell, `createRestarter().supervised` false under the preload) and the guard test (once it reads lowercase names) were red without `pm_id` on the list. Full `npm test`: 9 250 tests, 0 failures in a clean shell and under `pm_id=0 NODE_ENV=production PUBLIC_SITE_ORIGIN=… PUBLIC_API_RATELIMIT_MAX=5`.
- [x] Rule 12, reading of 2026-11-02 (audit R14 L-1): `server-test-app-env.unit.test.js` stays 8 tests. The probe test gains 12 forms (destructuring of a bound env, of an injected env and of `opts.env`, `in env`, `{ ...env }`, `Object.keys(env)`, `env` as a sole and as a second call argument to a callee naming it `cfg`, `const e = env`, `require('process').env.X`, `const { X } = require('node:process').env`, `const { env: e } = require('process')`): 11 of them got past the previous guard (the last was already caught by the `env: other` rename), the new guard fails on all 28 plus the plain read. The same 12 dropped one by one into `src/utils/` turn the guard test red. The quiet-forms test adds `env` handed to a callee declaring `env` at that position, `if (!env)`, and `env` inside an object and an array. On `src/` the new patterns found 6 files: 4 whose `env` is no process environment and 2 listed files (`localEnv` +1, `qontoSettingsController` +1), all pinned with their reason. The Neat pins apply only when the Neat plugin is shipped (`missingPlugins`), so the Neat cell of the plugin removal matrix sees no missing pin (its stale check stayed red until the review of #924, below; the « bare install » job never runs this file). Full `npm test`: 9 259 tests, 0 failures in a clean shell and under `PUBLIC_SITE_ORIGIN=… PUBLIC_API_RATELIMIT_MAX=5 NODE_ENV=development GUESTFLOW_MANAGED=1 pm_id=0`.
- [x] Rule 12, reading of 2026-11-02 (review of #924): `server-test-app-env.unit.test.js` now 9 tests (+1, the plugin-keyed names). The probe test gains 10 forms (`e = env || {}`, `e = env ?? {}`, a local function and a local method sharing their name with a function of another file that declares `env`, a package callee and an imported callee whose module does not declare `env` there while another file does, an `env` returned whole, an identity callee declaring `env`, `function fromIt(env) { return env; }`, `({ env })` read as `f().env.X`): all 10 got past the previous guard, the new one fails on all 38 plus the plain read. The quiet-forms test adds an imported callee as `{ f }`, `mod.f`, `{ f: g }` through a re-export and `require('./m').f`, and `'… not set in env'` in a string; the previous guard flagged the re-exported `{ f: g }` and the string. The same 10 forms dropped into `src/utils/` (a form's other files beside it) turn the guard test red; the previous guard let all 10 through there too. On `src/` the scan reads the same 100 names and finds one more indirect access, `return env` in `updateStaging.js` (pin 3 → 4). Removal matrix (`node scripts/plugin-removal.mjs remove <id>` in a copy of the tree, then this file): before, 5 of the 16 cells red (gate-access, google-calendar, neat, online-payment, website-booking, each on its own names called stale); after, 16 of 16 green. The plugin-keyed test fails when `PAYMENT_POLL_TICK_MINUTES` is moved back to the core list, and when a name the plugin does not read is keyed under `neat`. Full `npm test`: 9 260 tests, 0 failures; this file also green at `TZ=Pacific/Kiritimati` under `PUBLIC_SITE_ORIGIN=… PUBLIC_API_RATELIMIT_MAX=5 NODE_ENV=development pm_id=0`.
- [x] Rule 12, reading of 2026-11-02 (audit R15 L-1): `server-test-app-env.unit.test.js` stays 9 tests. The probe test gains 5 forms (`x ? env : {}`, `x ? {} : env`, `read(process)` and `read(1, process)` to a callee destructuring `{ env: { X } }`, and a top-level `read(env)` whose callee names `cfg` while a nested `read` declares `env`): all 5 got past the previous guard, the new one fails on all 43 plus the plain read. Each of the 5 dropped alone into `src/utils/` turns the guard test red; the previous guard let all 5 through there. The quiet-forms test adds a call to a nested function declaring `env` beside a top-level one that does not, `x ? env.X : null`, and `({ value: env, source: env ? 'env' : 'none' })`. The auditor's harness now reports only `[env][0].X` and `{ cfg: env }` as missed, both listed as not caught. On `src/` the new patterns add no hit and no pin (the `:` branch, before it was limited to ternaries, flagged the Neat `environment: env` and `qontoConfig`'s `value: env`). Full `npm test`: 9 278 tests, 0 failures.
- [x] Rule 12, reading of 2026-11-02 (review of #927): `server-test-app-env.unit.test.js` stays 9 tests. The probe test gains 4 forms (`x || env`, `x && env`, `read(o || env)` to a callee naming `cfg`, `await env`): all 4 got past the previous guard, the new one fails on all 47 plus the plain read. Each of the 4 dropped alone into `src/utils/` turns the guard test red. On `src/` the new pattern adds no hit and no pin. Full `npm test`: 9 278 tests, 0 failures.
- [x] Rule 14: `test-preload-real-qonto-guard.unit.test.js` (5 tests): the hosts named and not, resolver, `fetch` and `https.request` refused with the process failing, a loopback dial untouched, both preloads. On the code before `qonto-settings-in-app.md` rule 5's reading, `qonto-env-base-wins` tripped it on `thirdparty.qonto.com`.
- [x] Rule 13: `server-test-env-trace.unit.test.js` (4 tests), red before the change (the tracer did not exist): a fake `src/` reading three unlisted names (by name on a bound `env`, by `in`, by a built key on a ternary) is recorded at its lines, while a listed name, a `GUESTFLOW_*` flag, a test helper, a plugin's test helper, a package, `node -e` and Node's own `FORCE_COLOR` read are not, and a spread and a child spawned without `env` are listed as whole takes; `report` fails naming the name, its line and test file, and fails on a missing or empty directory; under the proxy, coercion, delete, `in`, `Object.keys`, an inherited and an explicit child `env`, `TZ`, `loadLocalEnv`, `JSON.stringify` and a descriptor behave as before; under the `npm test` flags a probe file runs proxied and the runner prints the green line, a probe that plants an unlisted record turns the run red with every test passed, and a process outside the runner is not traced. The first full traced run found 12 names: 10 were Node's own reads on the app's behalf (`FORCE_COLOR`, `NODE_V8_COVERAGE`, undici's `JEST_WORKER_ID` / `UNDICI_NO_FG`, attributed to the calling `src/` line) and `updateStaging`'s proxy pass-through plus one `.env.local` name read back by `loadLocalEnv`, which led to the Node-frame rule and `READ_BY_DESIGN`; `server-test-ambient-flags` rule 12 test 1 saw the new runner variable. Full `npm test` after: 9 282 tests, 0 failures, trace green over 1 212 processes, 343 s (341 s at the base).
- [x] Rule 13, review of #928: `server-test-env-trace.unit.test.js` now 5 tests (+1): `isolationNone` reads `--test-isolation=none`, `--test-isolation none` and both under `--experimental-`, the last one given winning, and a real runner given the two-argument form makes no directory and prints no trace line. Red before: the two-argument form made a directory no test process wrote to, and the run failed with « no test process wrote ». After merging #927: full `npm test` 9 283 tests, 0 failures, trace green over 1 212 processes, 333 s.
- [x] Rule 7, reading of 2026-11-03 (audit R20-S1 and R20-S2): `test-suite-calendar-and-ci-budget.unit.test.js` now 19 tests (+1). The injected-clock test is rewritten (a replaced `getTodayIsoDate` / `todayIso`, a `NOW`, a `now:` now leave their dates named; a pure-function input under the marker is not) and a new test names a past date down to `horizonStart` (`balancePaidDate: '2026-10-12'`, `query: { today: '2026-01-01' }`, a compact `'20220115'`, a template or `Date.UTC` year from the window's first year), not the day before it nor an impossible day, and checks that the guard opens where `horizonStart` does on 2026-11-03, 2028-02-29 and 2027-01-01. Both were red on the previous script, and so was the rule 6 test once it reads `R20_SWEEP` (55 more files). Review of PR #943 (nit closed 2026-11-03): one more test, 20 in all — the far end is
  inclusive, today + 10 years named and the day after not, a year alone the same, on 2026-11-03, 2027-12-31 and
  2028-02-29 (its far end the 28th); an exclusive end (`<`) turns it red. Replayed on the 40 merges #897–#938, each on its merge day: the previous script named 105 lines in 4 PRs, the new one 170 in 10 — 26 lines in 6 of the 36 merged since the guard turned blocking (#900 on), each a past date or an injected-clock date. Clock-shift differential of the whole server suite at 2031-11-03 09:00Z (Europe/Paris, `shift-clock.cjs` preload), five-year window vs. a 50-year one: 136 tests red for the window alone before, 0 after (15 red in both: the window's own boundary tests and the mixed-clock ones, SQLite's `datetime('now')` against the shifted `Date`). The changed files (63) at 2026-11-03, 2026-12-31 23:30Z, 2027-03-01, 2027-08-17, 2028-02-28 23:30Z, 2029-03-31 22:30Z and 2030-10-27 01:30Z: red only on mixed-clock `rule 9 — a date before the reservation was created` from 2028. `PeriodSelector.test.jsx` under the same preload: 2 red at 2031-11-03 before, 3/3 after. R20-S1 on the real clock at 00:33 in Paris (2026-11-03): `stored-split-only-with-contribs` 3/4 with the four files as they were (« La réservation n'existait pas encore le 02/11/2026. »), 4/4 after; the whole server suite on the real clock past midnight, 9 453 tests, only the rule 6 test red (before the sweep). Full `npm test` after: 9 453 tests, 0 failures; client 679 files / 3 266 tests.

- [x] Rule 15 (2026-11-10, audit R36-S4): `test-timeout-under-file-cap.unit.test.js` (3 tests) — the cap read from the
  script, no server test option above it (the fuzz's 300 000 ms was the one, red before), the reader's forms, and the
  fuzz split in two files over `tests/inputShapePerField.js` (3 398 + 1 743 requests, about 21 s and 5 s alone).
- [x] Rule 16 (2026-11-10, audit R36-S3): the six client files listed give each test 15 000 ms; the hourly-resources
  dialog suites and `ClientsPage.stale-impact` pass 12 runs in a row on a loaded machine.
- [x] Rule 17 (2026-11-10, verification R36b): `client-test-budget.unit.test.js` (3 tests) — `testTimeout: 30000` in
  `vitest.config.js` (inherited by the race-sweep config), `configure({ asyncUtilTimeout: 5000 })` in `setupTests.js`,
  and no per-test timeout left in the rule-16 files. Whole client suite at load 26: 863 files / 3 937 tests green.

## 8. Out of scope

- E2E runs write `server/.env.local` through `instancePaths`; that is a separate, by-design path.
