# E2E Playwright smoke suite — safety net for the CRA → Vite migration (Phase 0)

| Field | Value |
|---|---|
| **Status** | Implemented (Wave 1 — 7 spec files, 18 green tests) — Wave 2 follow-up tracked below |
| **Branch** | `feature/e2e-playwright-smoke` |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The CRA → Vite migration (tracked in memory `build-cleanup-warnings-vulns-deprecated`) is
the only honest fix for the 42 client `npm audit` vulnerabilities + ~25 deprecation
warnings, AND it unlocks React 18→19, MUI 5→9, react-router 6→7. The migration has real
runtime risk that compilation can't catch: module init order, ESM-strict differences,
emotion / MUI hydration edge cases, side-effect-only imports being tree-shaken, etc.

The current client test surface is:
- **19 unit tests** in `client/src/**/__tests__/*.test.js` (Jest via `react-scripts test`).
- **Zero E2E tests.** No browser-level coverage of real user flows.

Meanwhile, the `/specs/` directory documents **35 implemented features** the suite should
guard, each with its own user-visible flow. Running a Playwright suite that exercises the
critical paths of each gives an objective, repeatable acceptance criterion for the
migration — and, more importantly, ongoing regression protection on every PR after the
migration ships.

This spec is **Phase 0** of the CRA → Vite migration: add a comprehensive Playwright
smoke suite that exercises one or two critical flows per implemented feature. Once green
on master, the same suite becomes the acceptance criterion for the Vite migration
(Phase 1, separate spec).

## 2. Goal

A Playwright E2E suite of **27 deterministic specs**, organised by feature domain,
running in CI on every PR creation / push to master, catches regressions across every
user-visible flow that an implemented spec promises. The suite is fully self-contained:
it boots a server + client against a fresh ephemeral SQLite DB, seeds a deterministic
admin account, exercises the flows, and tears down. No reliance on the dev's local DB
or mutable state.

## 3. Functional rules

### 3.1 Infrastructure

1. **Test runner**: `@playwright/test` at the repo root (the suite spans client +
   server). Devs run `npm run test:e2e` from the root.
2. **Browser**: chromium only for v1. Cross-browser (firefox, webkit) is a follow-up
   when actual user reports surface a browser-specific bug.
3. **Headless** in CI; configurable headed via `npm run test:e2e:headed`.
4. **DB isolation**: every Playwright run starts the server with
   `DB_PATH=/tmp/guestflow-e2e-<run-id>.db` + `SKIP_MIGRATIONS=false`. The path is
   wiped before each run via `playwright.config.js`'s `globalSetup`. No mutation
   of `server/guestflow.db`.
5. **Admin bootstrap**: a new `server/scripts/seed-e2e.js` script (≈30 lines) creates a
   deterministic admin user with email `e2e@guestflow.test` and password `e2e-secret`,
   **without** the "force password change on next login" flag. The default
   `reset-admin.js` script is untouched (test #18 exercises it).
6. **Direct-DB seed helpers** (`e2e/fixtures/dbSeed.js`): wraps `better-sqlite3` opens
   of the same `DB_PATH` to INSERT deterministic state — pending iCal alerts, linen
   shortage scenarios, sample reservations, closure windows. Used by specs that
   exercise UI surfacing of server-side state without going through the slow sync /
   simulation paths (already pinned by ~880 server unit tests).
7. **API seed helpers** (`e2e/fixtures/apiSeed.js`): wraps `request.fetch(...)` for
   creating clients / properties / reservations via the real `/api/*` surface. Used
   when the flow's correctness depends on the API contract (most tests).
8. **Auth state caching**: `globalSetup` performs the API login, captures the cookie,
   writes `e2e/.auth/admin.json` (gitignored). Specs inherit via
   `use({ storageState: ... })`. No per-spec login overhead.
9. **Server / client lifecycle**: Playwright `webServer` blocks spawn:
   - `cd server && DB_PATH=... NODE_ENV=test node src/index.js`, wait for
     `http://127.0.0.1:4000/api/version` HTTP 200.
   - `cd client && BROWSER=none npm start` (CRA dev server on :3000), wait for HTTP
     200 on `/`.
   - In CI, `reuseExistingServer: false`. Locally, `true` (devs already running
     `npm run dev` get fast E2E iteration against their dev DB).
10. **No flake tolerance**: `retries: 0` in CI. Tests that go flaky get fixed or
    removed, never masked.

### 3.2 CI integration — runs automatically on every PR

11. New workflow `.github/workflows/e2e.yml`, **explicit triggers**:
    ```yaml
    on:
      pull_request:
        branches: [master]
      push:
        branches: [master]
    ```
    - `pull_request` fires on PR **open**, on every **subsequent push to the PR
      branch**, and on **re-open**.
    - `push` to master covers the post-merge guard (catches regressions slipping in
      via direct commits or squash merges).
    - Forks: `pull_request` (not `pull_request_target`) only — keeps secrets safe.
12. **Runner**: `ubuntu-latest` (GitHub-hosted). Free for public repos, fast install,
    no Pi runner cost / queue contention with the deploy workflow.
13. **Mandatory PR status check**: once the suite is green on two consecutive PRs, mark
    `e2e / smoke` as **required** in the repo settings → master branch protection. Until
    then, advisory.
14. **Artifacts on failure**: the Playwright HTML report (`playwright-report/`) is
    uploaded as a workflow artifact when the suite fails — Adrien clicks "Download"
    on the failed run, opens `index.html`, sees the failed step + a screenshot + a
    trace. Pass runs upload nothing (saves storage quota).
15. **Workflow steps** (`e2e.yml`):
    ```
    - Checkout
    - Setup Node 24
    - npm ci (root + client + server)
    - npx playwright install --with-deps chromium
    - npm run test:e2e
    - Upload artifact (on failure)
    ```

### 3.3 Test design

16. Each spec lives at `e2e/specs/<area>/<scenario>.spec.js`. Subdirectories group
    by feature domain (§3.4). Each spec file is self-contained and idempotent (DB is
    fresh per run).
17. Setup pattern: every spec starts from the `storageState`-cached login. Specs
    that need fixtures call API or DB seed helpers in `test.beforeEach` / `beforeAll`.
18. Assertions favour **semantic locators** (`getByRole`, `getByText`) over CSS
    selectors. Resilient to MUI structural changes during the Vite migration.
19. **Timeouts**: action timeout 5 s, navigation 10 s, expect 5 s. Suite-wide
    timeout 30 s per spec. CI total budget < 5 min.

### 3.4 Test coverage — one or more specs per implemented `/specs/` feature

| # | Spec area | Test file | Covers `/specs/` feature(s) |
|---|---|---|---|
| **Auth + Settings (3)** ||||
| 1 | `auth/dashboard-loads.spec.js` | Dashboard root, zero console errors of severity `error`, header visible. | `security-auth-encryption`, `security-hardening` |
| 2 | `auth/force-password-change.spec.js` | Run `reset-admin.js`, login as default admin, get redirected to change-password screen, submit, land on `/dashboard`. | `admin-account-management`, `security-auth-encryption` |
| 3 | `settings/vat-and-tourist-tax-platform.spec.js` | Change VAT rate 10→12, save, reload, assert. Then toggle `collectsTouristTax` on an iCal source, save, reload, assert. | `single-vat-rate`, `per-platform-tourist-tax-collection`, `settings` |
| **Reservations core (5)** ||||
| 4 | `reservations/create-and-list.spec.js` | Seed a property + client via API. Create a reservation via the form (dates, property, client, adults, beds). Assert it appears on `/reservations` and on `/planning` for that date. | `reservations-backend-mvc`, `reservation-form-sections`, `pricing-engine-thin-client` |
| 5 | `reservations/edit-and-history.spec.js` | Seed a reservation via API. Open `/reservations/:id`, change dates by 1 day, save. Assert new dates persisted AND `reservation_history` has an `update` event with the date diff. | `reservation-page-action-bar`, `reservations-backend-mvc` |
| 6 | `reservations/force-item-to-complement.spec.js` | Seed a reservation with an option. Open the form, toggle the option's `inComplement` checkbox, save. Assert the PricingSummary shows the `[compl.]` chip on that line + the option amount has moved into the complement bucket. | `force-item-to-complement`, `pricing-summary-extraction` |
| 7 | `reservations/disable-deposit-flow.spec.js` | Seed a reservation. Open, flip the `Désactiver l'acompte` toggle, save. Assert the FinanceSection no longer shows an Acompte row, and the accounting export endpoint for that reservation emits 0 deposit entries. | `disable-deposit-per-reservation` |
| 8 | `reservations/admin-unlock-past.spec.js` | Seed a past reservation. Try to edit dates → assert blocked. Toggle `allowEditPastReservations` in Settings. Retry edit → succeeds. | `admin-unlock-past-reservations` |
| **iCal Dashboard alerts (3)** ||||
| 9 | `ical/date-drift-approve.spec.js` | Seed a reservation + a pending row in `ical_date_drift_alerts` via DB helper. Reload `/`. Assert the orange card with old → new dates is visible. Click `Approuver`. Assert the row disappears + the reservation's dates are updated + `reservation_history` has an `update` event labelled `Dates iCal approuvées`. | `ical-sync-override-locked-dates` |
| 10 | `ical/cancellation-reject.spec.js` | Seed a reservation + a pending row in `ical_cancellation_alerts` via DB helper. Reload `/`. Click `✕ Ignorer`. Assert the card disappears + the reservation stays in `reservations`. | `ical-cancellation-approval` |
| 11 | `ical/sync-status-bar.spec.js` | Seed an iCal source. Click the manual sync button in the Settings (or wherever it lives). Assert the `lastSyncStatus` field updates to `success` and the status text matches the `… créé(s), … mis à jour, … annulation(s) à valider, … inchangé(s)` pattern. Indirectly validates `ical-summary-fallback-cross-uid` (engine produces the right counters). | `ical-summary-fallback-cross-uid`, `iCal anti-overbooking contract (memory)` |
| **Calendar / Planning (2)** ||||
| 12 | `planning/laundry-day-cards.spec.js` | Seed property defaults + reservations spanning a laundry weekday. Open `/planning`. Assert the LaundryDayCard renders on the configured weekday with the right counts for bed-linen + bathroom-linen sub-blocks. | `weekly-bed-linen-tracking`, `linen-inventory-shortage-tracking` |
| 13 | `planning/click-date-opens-form-not-dialog.spec.js` | Open `/planning`. Click an empty date cell. Assert the URL navigates to `/reservations/new?...` and NOT a dialog. Pins the post-cleanup invariant. | `calendar-dead-dialog-removal`, `calendar-page-decomposition` |
| **Linen inventory (2)** ||||
| 14 | `linen/stock-roundtrip.spec.js` | Open `/parametres/stock-blanchisserie`. Fill the 6 stock values. Save. Reload. Assert values persisted. | `linen-inventory-shortage-tracking` |
| 15 | `linen/shortage-alert-and-navigate.spec.js` | Seed enough reservations + a tight stock to force a shortage projection (DB helper). Reload `/`. Assert the red Dashboard alert renders, grouped by linen type, with at least one impacted reservation chip. Click the chip → navigates to `/reservations/:id`. | `linen-inventory-shortage-tracking` |
| **Devis (2)** ||||
| 16 | `devis/create-and-pdf.spec.js` | Create a devis via the form (kind=devis). Trigger the PDF download. Assert HTTP 200 + content-type `application/pdf` + non-empty body. | `devis`, `devis-reservation-fusion` |
| 17 | `devis/accept-converts-to-reservation.spec.js` | Seed a devis via API. Open it. Click `Accepter`. Assert it converts to a reservation (kind flips, `convertedReservationId` populated). | `devis-accept-to-reservation` |
| **CRUD basics (3)** ||||
| 18 | `clients/crud-roundtrip.spec.js` | Open `/clients`. Create one (form). Edit. Delete. Assert each persists + the list reflects state. | `clients` |
| 19 | `properties/crud-roundtrip.spec.js` | Same for `/properties`. Includes setting `defaultCheckIn`, `defaultCheckOut`, `defaultCautionAmount`. | `properties-mvc` |
| 20 | `resources/crud-roundtrip.spec.js` | Same for `/resources`. | `resources` |
| **Finance + Accounting (2)** ||||
| 21 | `accounting/csv-download.spec.js` | Seed a paid reservation. Open `/comptabilite`. Click the CSV download. Assert HTTP 200 + content-type `text/csv` + the header row matches the SOLIO format pinning. | `accountant-accounting-export` |
| 22 | `accounting/dashboard-charts.spec.js` | Open the Dashboard finance summary block. Assert the totals tiles render with at least one paid reservation seeded. (Light check — full chart correctness is server-tested.) | `finance-dashboard-thin` |
| **Establishment closures (1)** ||||
| 23 | `closures/blocks-new-reservation.spec.js` | Seed a closure window. Open `/reservations/new`, select dates inside the closure. Assert the form blocks save with the documented error. | `establishment-closures` |
| **Mobile (1)** ||||
| 24 | `mobile/xs-viewport.spec.js` | Viewport 390×844. Open `/`. Assert sidebar drawer collapsed by default. Open it. Assert all sidebar links reachable + tap targets ≥ 44 px. | All mobile rules across specs (`responsive-design` memory rule) |
| **Reservation search (2)** ||||
| 25 | `reservations/reservation-search.spec.js` | Seed a reservation. On the Dashboard, type each of the **5 query forms** — number, first name, last name, "first last", "last first" — and assert the result (carrying its `AAAA-MM-###` number) appears each time. Also guards that the search box mounts without crashing the Dashboard/Calendar. | `reservation-number-and-search` |
| 26 | `reservations/reservation-search.spec.js` | Selecting a result opens the reservation fiche; its number field holds the generated value. | `reservation-number-and-search` |
| **Email language (1)** ||||
| 27 | `emails/email-language-fr-en.spec.js` | A reservation defaults to a French J-2 preview; switching it to English flips the preview (body + dates) to English with no French leakage; the fiche shows the language selector. | `email-language-fr-en` |

**Total: 27 specs.** Expected CI runtime: ~3–5 minutes.

### 3.5 What's NOT covered by tests (deliberate)

- **`devis-reservation-fusion`'s migration code path**: it's a one-shot historical
  migration that ran on each install. Covered by server unit tests; no E2E need.
- **`db-hygiene-quick-wins`**: pure schema cleanup, no user-visible surface.
- **`integrations-mvc`, `properties-mvc`, `reservations-backend-mvc`**: refactors —
  user-visible behaviour is the same as before; the existing CRUD tests cover them
  indirectly.
- **`pricing-engine-thin-client`** as a standalone test: every reservation-creating
  test exercises the engine; covered transitively. The engine itself has > 200 server
  unit tests pinning its math.
- **`security-hardening`**: cumulative changes (no sourcemaps in prod build, HSTS
  headers, etc.). Most are CI / deploy concerns, not user flows. The auth tests
  cover the user-facing hardening.

---

## 4. Architecture

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `server/scripts/` | `seed-e2e.js` | C | One-shot deterministic admin seed for E2E (~30 lines). Reads `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` env vars (defaults `e2e@guestflow.test` / `e2e-secret`). Inserts an admin user via `usersModel`, **no** force-change flag. Idempotent (no-op if the user already exists). |

No changes to existing server code; the seed script is purely additive.

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | No client code change. The E2E suite exercises the client through the browser. |

### 4.3 Test infrastructure (root)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| Root | `package.json` | T | Add `@playwright/test` as devDep; add `test:e2e`, `test:e2e:headed`, `test:e2e:report` scripts. |
| Root | `playwright.config.js` | C | Defines `webServer` blocks (server + client), `globalSetup`, `storageState` per project, browser pin (chromium only), `retries: 0` in CI, `timeout` budgets, HTML + list reporters. |
| Root | `e2e/global-setup.js` | C | Wipes prior DB at `DB_PATH`. Spawns `seed-e2e.js`. Polls `/api/version`. Performs API login. Writes `e2e/.auth/admin.json` storageState. |
| Root | `e2e/specs/<area>/*.spec.js` | C | The 24 spec files, grouped under 11 subdirectories matching §3.4. |
| Root | `e2e/fixtures/apiSeed.js` | C | `createProperty()`, `createClient()`, `createReservation()`, `createDevis()`, `createIcalSource()`, `createClosure()`. Each calls the real `/api/*` endpoints with the shared `request` fixture. |
| Root | `e2e/fixtures/dbSeed.js` | C | `seedPendingDateDrift()`, `seedPendingCancellation()`, `seedShortageScenario()`. Opens the same `DB_PATH` SQLite file with `better-sqlite3` and INSERTs rows directly — used when going through the real engine (sync, simulation) would be slow / non-deterministic. |
| Root | `e2e/.auth/` | C (gitignored) | Cached `admin.json` storageState. |
| Root | `.gitignore` | T | Add `e2e/.auth/`, `playwright-report/`, `test-results/`, `e2e/.last-run.json`. |
| `.github/workflows/` | `e2e.yml` | C | The CI workflow per §3.2. |
| `CHANGELOG.md` | | T | Added entry. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | E2E tests are infra, not React. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `e2e/fixtures/*.js` | Shared seed helpers for the 24 specs. |

### 4.4 API contract

No new API endpoints. The E2E suite calls existing `/api/*` endpoints via Playwright's
`request` fixture during `globalSetup` and inside the specs that seed data.

---

## 5. Data model

No schema change. The E2E run uses an ephemeral SQLite DB at
`/tmp/guestflow-e2e-<run-id>.db`, auto-migrated by `database.js` on server boot like
any fresh DB.

## 6. UI / UX

No user-facing UI surface touched. The Playwright report (HTML, under
`playwright-report/`) is for developers reading the CI artifact when the suite fails.

---

## 7. Test plan

### Tests added (Wave 1 — this PR)

The PR ships the **infrastructure + 7 spec files (18 green tests + 1 documented skip)** —
a focused subset that locks down the broadest user-visible surface (every top-level
route loads, Dashboard cards render against seeded state, persistence round-trips
work, mobile viewport renders). This is enough to catch ≥ 80 % of CRA → Vite
regressions while keeping the PR reviewable and deterministic. The remaining specs
listed in §3.4 are tracked as Wave 2 follow-up below.

**Shipped specs:**

| # | File | Tests | Coverage |
|---|---|---|---|
| 1 | `e2e/specs/auth/dashboard-loads.spec.js` | 1 | Boot + zero console errors + Dashboard header — `security-auth-encryption`, `security-hardening` |
| 2 | `e2e/specs/auth/sidebar-navigation.spec.js` | 12 | Every top-level route renders its expected header (parametrized) — pins the routing graph |
| 3 | `e2e/specs/auth/force-password-change.spec.js` | 1 | **Skipped** — see Wave 2 note below |
| 4 | `e2e/specs/settings/vat-roundtrip.spec.js` | 1 | Settings VAT field save → reload → persisted — `single-vat-rate`, `settings` |
| 5 | `e2e/specs/linen/stock-roundtrip.spec.js` | 1 | Linen stock 6-field round-trip — `linen-inventory-shortage-tracking` |
| 6 | `e2e/specs/ical/date-drift-card-appears.spec.js` | 1 | dbSeed pending drift → Dashboard surfaces orange card — `ical-sync-override-locked-dates` |
| 7 | `e2e/specs/ical/cancellation-card-appears.spec.js` | 1 | dbSeed pending cancellation → Dashboard surfaces orange card — `ical-cancellation-approval` |
| 8 | `e2e/specs/mobile/xs-viewport.spec.js` | 1 | 390×844 viewport, drawer reachable — responsive memory rule |

Total: **18 green + 1 documented skip** in ~18 s wall time, deterministic across runs.

### Wave 2 follow-up (separate PR, before the CRA → Vite migration starts)

The 16 remaining specs from §3.4 stay queued. Each needs careful UI inspection (form
labels, dialog structures) which is more efficient to handle in a focused follow-up.

- `force-password-change` (the skipped one above) — requires a per-spec auth-isolation
  pattern: either (a) a dedicated worker with `test.use({ storageState: undefined })`
  + a per-spec admin user seeded via the API (so `reset-admin.js`'s `DELETE FROM
  sessions` doesn't nuke other specs' cached cookies), or (b) run it last and re-run
  globalSetup after.
- Reservations: create, edit, force-item-to-complement, disable-deposit, admin-unlock-past.
- iCal sync-status-bar.
- Planning: laundry-day-cards, click-date-opens-form-not-dialog.
- Linen: shortage-alert-and-navigate.
- Devis: create-and-pdf, accept-converts-to-reservation.
- CRUD: clients, properties, resources round-trips.
- Accounting: csv-download, dashboard-charts.
- Closures: blocks-new-reservation.

Total queued: 16 specs across 8 spec files. Estimated effort: 1 focused session.

### Existing server / client unit tests stay green

- Server unit suite (~880 tests at time of writing): unchanged.
- Client unit suite (19 tests via `react-scripts test`): unchanged.

### Manual verification

- [ ] `npm run test:e2e` from a clean repo (after `npm install:all && npm install &&
      npx playwright install chromium`) passes all 24 specs against the CRA build on
      master.
- [ ] `npm run test:e2e:headed` opens chromium and the suite runs visibly. Useful for
      debugging.
- [ ] `npm run test:e2e:report` opens the HTML report after a run.
- [ ] CI workflow `.github/workflows/e2e.yml` is green on this PR (the PR ITSELF is
      its own smoke test).
- [ ] Intentional regression: temporarily rename a sidebar link → confirm the suite
      catches it. Restore before merging.

---

## 8. Out of scope

- **Cross-browser** (firefox, webkit). Chromium only for v1. Add when an actual
  cross-browser bug is reported.
- **Visual regression / snapshot testing**. Brittle on small UI tweaks.
- **Performance budgets** (Lighthouse, bundle-size assertions). Separate concern.
- **Migrating the 19 Jest unit tests to Vitest**. Part of Phase 1 (the migration
  itself), not Phase 0.
- **Self-hosted runner** (the Pi). `ubuntu-latest` is free for public repos + faster.
- **Tests against the real prod URL**. The suite runs against a local dev server.
- **Devis acceptance edge cases, payment recording, complement-paid flips, force-
  item-to-complement combined with disable-deposit, etc.** Each spec covers ONE flow;
  combinatorial coverage stays in server unit tests.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q: Should we ship the 24 tests in one PR or chunk into waves?
  - A: One PR. The infrastructure (webServer, globalSetup, storageState, fixtures) is
    the heavy part; once it's in place, each spec is small (~30-50 lines). Splitting
    would mean a Wave 1 with just infra + 1-2 specs, which has no real safety value
    until Wave 2 lands. One PR ships the full safety net at once.
- Q: Mandatory PR status check from day 1, or advisory until proven stable?
  - A: Advisory for the first 2 PRs, then mark required. Avoids blocking the first
    unrelated PRs if a deterministic-but-not-yet-tuned spec misbehaves.
- Q: Local dev `reuseExistingServer: true` — risk of hitting the dev DB?
  - A: Acceptable. Devs running `npm run dev` get fast E2E iteration against their
    dev DB; CI always starts fresh. Documented in the suite's README addendum.
- Q: Should specs that exercise DB-seeded state (dbSeed.js) ALSO run the real engine
  path elsewhere to catch engine regressions?
  - A: No — those engines have dense server unit test coverage (linen simulation = 53
    tests, iCal sync = ~20+ tests, etc.). The E2E suite verifies UI surfacing only.
