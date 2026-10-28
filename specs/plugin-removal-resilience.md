# Plugin removal resilience — every plugin can go, and everything else keeps working

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/plugin-removal-resilience` (from `inte/plugins` at 645e812d) |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Builds on** | [`plugins-phase-0-foundation.md`](plugins-phase-0-foundation.md) rule 28 (bare install), [`plugins-phase-1-sdk.md`](plugins-phase-1-sdk.md) rules 2–4, [`plugins-phase-4-registry.md`](plugins-phase-4-registry.md) rules 14, 19 |
| **Summary for review** | [`docs/specs/2026-10-28-plugin-removal-resilience.html`](../docs/specs/2026-10-28-plugin-removal-resilience.html) |

---

## 1. Context

Feedback of 2026-10-28 on the `inte/plugins` shadow: « Il faut que tu testes si le retrait de plugin
permet tout de même à tout le reste de fonctionner. Ce que je veux c'est que tu testes le retrait de
chaque plugin, et pour chaque retrait tu t'assures que tout le reste fonctionne encore. »

GuestFlow ships 16 plugins (re-audited on 2026-10-28 against `inte/plugins` 645e812d, which holds the whole 28/10 wave: the catalogue is unchanged — 16 manifests, the same ids and requirements — and the wave added no host slot a core file reads by plugin id; `online-payment` gained its reconciliation tables and `linen` its schedule tables, already declared in their erasure lists) (`server/src/plugins/<id>`, `client/src/plugins/<id>`, one `manifest.json`
each). Today CI proves two extremes only:

- **everything installed** — the server suite, the client suite and the E2E smoke (`e2e.yml` « smoke »);
- **nothing installed** — the bare-install suite (phase 0 rule 28, `e2e.yml` « bare install »).

Nothing proves the 16 states in between — « every plugin but this one » — nor the three ways a plugin
leaves: **deactivated** (row `enabled = 0`, data and settings kept, phase 0 rule 5), **uninstalled**
(row deleted, data kept, rule 6, optionally purged, phase 1 rules 12, 21–24), and **absent** (its code
is not shipped: a package missing or incompatible, phase 4 rule 14, or a distribution without it).

### 1.1 What was measured on 2026-10-28

Three experiments, all reproducible from the scratchpad scripts described in §7.4.

**A. Deactivate / uninstall / reinstall, one plugin at a time, on real data.** A copy of the shadow
database (prod data of 2026-10-22), the production build (`GUESTFLOW_PLUGINS=packages`, built client,
`plugins-dist/`) on port 4860. For each of the 15 installed plugins: deactivate through
`POST /api/plugins/:id/deactivate` → headless sweep of 40 pages (the core pages, five fiches carrying
plugin data, the plugin pages typed by hand), recording page errors, console errors, every `/api`
answer ≥ 400 and the error boundary → reactivate → `DELETE /api/plugins/:id` (data kept) → **restart**
(the package is then really not loaded: `entries.json` no longer lists it) → same sweep → reinstall →
restart → same sweep.

Result: see §1.3 — the runtime holds; the breakages are elsewhere.

**B. The plugin's code absent.** For each of the 16 plugins, a sandbox copy of the worktree with
`server/src/plugins/<id>` and `client/src/plugins/<id>` deleted and its line removed from both module
lists, then: boot, the full server suite, the full client suite, diffed against an untouched sandbox.

**C. Static map.** Every import, hard-coded id, `isLive(...)` call, plugin-owned table read by the core,
and cross-plugin collaboration (§1.2).

### 1.2 Dependency map — what depends on each plugin

Runtime couplings are all gated by `registry.isLive(id)` (core) or by the plugin registry hooks
(`emailProviders`, `sasProviders`, `sasCommits`, `priceLineContributor`, `reservationBlocks`,
`attention`, `pushChannels`, events, client slots) — a plugin that is not live contributes nothing.
No core source file imports a plugin folder (guarded by `tests/plugins-phase-1-sdk.unit.test.js` and
`client/src/plugins/sdk/__tests__/registry.test.jsx`), and no plugin source imports another plugin.

| Plugin | Core couplings (all gated) | Other plugins | Tables it owns (left behind on uninstall) | Tests outside its folder that import it |
|---|---|---|---|---|
| `accounting-export` | role `accountant` (`ROLE_PLUGINS`, uninstall blocker), Finance menu for accountants | — | none (settings only) | 12 core server tests (`arrival-payment-books`, `cancellation-accounting`, `reservation-ledger-*`, `tourist-tax-collection-coverage`…) |
| `airbnb-intake` | intake banner (SDK `IntakeBanner`), attention | — | `airbnb_intakes` | — |
| `booking-intake` | public route `/public/booking-intake` (operator userscript) | — | `booking_intakes`, `booking_dismissals` | `dashboard-attention` |
| `gate-access` | email tokens `gateAccessCode`/`gateAccessUrl` + flag (empty when not live, `emailContextBuilder.js:463`), public `/public/v1/gate` (the house calls it) | its step inside `sas` | `gate_key_results`, `gate_connector_state` | `dashboard-attention`, `hosting-h2-support-*` (2), `plugins-phase-1-sdk` |
| `gites-de-france-intake` | intake banner, attention | — | `gdf_intakes` | `dashboard-attention` |
| `google-calendar` | legacy settings map (`utils/pluginsSchema.js`) | — | none | `plugins-phase-0`, `plugins-phase-1-sdk` |
| `google-vacation-rentals` | — | **requires `website-booking`** (manifest); listens to `pricing.changed` from `tariff-recipes` | `gvr_*` (3) | `wordpress-plugin-landing-stay`; its own fixtures import `tariff-recipes` |
| `hourly-resources` | price type `per_hour` (`utils/priceLineContributors.js:30`, lines kept read-only `utils/resourceOffer.js`), `emailContextBuilder.js:106`, `stayFactsModel.js:23`, `resource_bookings` read by `resourceOtherUsesModel.js:30` and `resourcesModel.js:345` when the table exists | its « créneaux » step inside `sas` (`sasCommits`) | `resource_bookings` | 4 core tests; its own tests import `sas/controller` (2) |
| `linen` | bed-linen alert (`reservationsModel.js:1018`) | its steps inside `sas` | `laundry_*` (3) | `dashboard-attention`, `reception-planning-and-date-caps`, `plugins-phase-4-registry`, `plugin-packages-release` |
| `neat` | push column `user_push_prefs.neat` (legacy, `database.js:2266`) | its insurance offer in `website-booking`'s public projections | `neat_subscriptions`, `neat_price_cache` | `insurance-offer-follows-neat`, `plugins-phase-0`, `hosting-h2-support-guard`; its own tests import `website-booking` |
| `online-payment` | payment provider registry, `PLUGIN_OF_TEMPLATE` (4 request templates), `publicPaymentController.js:81`, deactivation/uninstall blocker on open links; **`emailsController.js:151-158` re-offers an open link in `deposit_reminder` whatever the plugin's state** | `website-booking` pay routes (`requireProvider`) | `bank_*` reconciliation (5); `payment_links` is a core table | 4 core tests |
| `sas` | role `reception` (blocker), `arrivalDeparturePushRunner.js:26`, `/parametres/tarifs` redirect (`App.jsx:822`), `productisationMigration.js:316` | hosts the steps of `linen`, `weather-alerts`, `gate-access`, `hourly-resources` | none (`linen_priced_items`, `repair_amounts` are core) | 3 core tests, 2 `hourly-resources` tests |
| `school-holidays` | settings menu label (`constants/settingsMenu.js:48`), calendar markers (slot) | — | `school_holidays`, `school_holidays_sync_state` | `settings-rationalization` (calls `applyPluginSchema('school-holidays')`), `plugins-phase-0/1` |
| `tariff-recipes` | emits `pricing.changed` | `google-vacation-rentals` fixtures | `tariff_recipe_runs` | `discount-monotonicity`, `pricing-changed-event`, `tariff-change-journal`, `dashboard-attention`, 2 `google-vacation-rentals` tests |
| `weather-alerts` | legacy settings map | its step inside `sas` | `weather_vigilance_cache` | `plugins-phase-1-sdk`, `hosting-h2-support-guard`, the `sas` client tests |
| `website-booking` | the whole `/public/v1` tree (the WordPress plugin's contract) | required by `google-vacation-rentals`; shows `neat`'s offer | `public_request_*` (4) | 5 core tests (`site-meal-portions`, `translation-resolver`, `wordpress-plugin-proof-of-work`…), `dashboard-attention`, `neat` tests |

Three blockers refuse a deactivation/uninstall while their data is live (`pluginsController.js:41`):
`online-payment` with an open link (the shadow has 5 → `409 OPEN_PAYMENT_LINKS`), `sas` with an
« Accueil »-only account, `accounting-export` with a « Comptable »-only account. One declared
requirement refuses the reverse order (`google-vacation-rentals` → `website-booking`, `REQUIRED_BY`).

### 1.3 Breakages found

**Runtime (experiment A): none on the 15 plugins.** With each plugin deactivated, uninstalled
(after a restart, package really not loaded) and reinstalled, the 40 pages render, no page error,
no error boundary, no console error, no `/api` answer ≥ 400 other than the Qonto API being
unreachable on purpose in the copy (`/api/payments/qonto/bank-accounts → 502`, present in the baseline
too). Each reinstall answers 200 and the plugin's data is back (data kept, rule 6). The architecture
of phases 0–4 holds where it matters most: the running app.

The two stays carrying per-hour « Bain nordique » lines (one with a session, one without) keep the
same `finalPrice` and the same line (quantity 1, 30 €/h, sessions kept) with `hourly-resources`
installed and uninstalled — `utils/resourceOffer.js` freezes them as designed. The three blockers
answered as specified (`OPEN_PAYMENT_LINKS` ×5 links, `ACCOUNTANT_USERS`, `RECEPTION_USERS`); the
sweep then forced the row in the database to go on.

| Plugin | Deactivated | Uninstalled + restart | Reinstalled + restart | Code absent: server boot | Code absent: test files newly failing (server) |
|---|---|---|---|---|---|
| `hourly-resources` | ok | ok | ok | **crash (B1)** | 9 |
| `linen` | ok | ok | ok | **crash** | 2 |
| `website-booking` | ok | ok | ok | **crash** | 7 |
| `gate-access` | ok | ok | ok | **crash** | 2 (one is `website-booking`'s own test) |
| `neat` | ok | ok | ok | **crash** | 0 files, engine subtests |
| `online-payment` | refused (5 links), forced: ok | refused, forced: ok | ok | **crash** | 2 |
| `google-calendar` | ok | ok | ok | **crash** | 0 files, engine subtests |
| `accounting-export` | refused (1 Comptable), forced: ok | refused, forced: ok | ok | **crash** | 8 |
| `sas` | refused (1 Accueil), forced: ok | refused, forced: ok | ok | **crash** | 1 |
| `tariff-recipes` | ok | ok | ok | **crash** | 6 (two are `google-vacation-rentals`') |
| `school-holidays` | ok | ok | ok | **crash** | 1 + 9 engine subtests |
| `weather-alerts` | ok | ok | ok | **crash** | 0 files, 16 engine subtests |
| `gites-de-france-intake` | ok | ok | ok | **crash** | 1 |
| `booking-intake` | ok | ok | ok | **crash** | 1 |
| `airbnb-intake` | ok | ok | ok | **crash** | 0 |
| `google-vacation-rentals` | not installed on the copy | — | — | **crash** | 1 (`plugins-activate-requires-active`: `findPlugin(...)` null) |

**The breakages are in the code layout and the test suites (experiment B), and in one latent path:**

| # | Breakage | Where | How reproduced |
|---|---|---|---|
| B1 | **The server does not boot without a plugin's folder.** `PLUGIN_CATALOG = CATALOG_ORDER.map(readSourceManifest)` reads `server/src/plugins/<id>/manifest.json` at module load and throws `ENOENT`. `constants/plugins.js` is required by every boot, packages mode included. | `server/src/constants/plugins.js:33`, `server/src/plugins/manifest.js:88` | sandbox without `weather-alerts` (any id): `require('./src/constants/plugins')` → `Error: ENOENT … plugins/weather-alerts/manifest.json`, exit 1 |
| B2 | **A row without a module counts as live in `sources` mode.** `registry.isLive(id)` answers `isActive(id)` when no record exists unless `requireRecord`, which only the `packages` boot sets. A deleted folder with its row still `enabled = 1` is then « live »: `/api/auth/me` lists it in `enabledPlugins`, `isLive('hourly-resources')`/`isLive('linen')`/`isLive('sas')` turn the core's branches on for code that is not there. | `server/src/plugins/sdk/registry.js:83-88`, `server/src/plugins/host.js` (`registry.configure({ requireRecord: true })` in the packages branch only) | sandbox without `weather-alerts`, its row `enabled = 1`, `host.boot` in `sources` mode: `registry.has('weather-alerts')` → false, `registry.isLive('weather-alerts')` → **true**, and it is in the `enabledPlugins` list `/api/auth/me` builds (`authController.js:289`) |
| B3 | **The core suites import plugin code.** 40 files under `server/src/tests/` (39 suites and one fixture) require a plugin folder; 3 client core tests too. Removing one plugin fails between 1 and 12 of them. | list in §1.2, last column; client: `pages/__tests__/Dashboard.server-today.test.jsx`, `Dashboard.beds-empty.test.jsx`, `pages/settings/__tests__/TermsSettingsPage.test.jsx` | sandbox without `tariff-recipes`: `discount-monotonicity`, `pricing-changed-event`, `tariff-change-journal`, `dashboard-attention` fail with `Cannot find module`; without `school-holidays`: `settings-rationalization` |
| B4 | **Plugins' tests import other plugins.** `google-vacation-rentals/tests/gvrFixtures.js:14-16` (tariff-recipes), `hourly-resources/tests/sas-preview-hook…:61`, `hourly-evening-billed-once…:210` (sas), `neat/tests/neat-guest-pricing…:22` (website-booking), `website-booking/tests/phase-2-website-booking.unit.test.js:27` (gate-access); client `sas/__tests__/ReservationSasDialog.plugins.test.jsx` (weather step). | as listed | sandbox without `tariff-recipes`: 2 `google-vacation-rentals` suites fail; without `weather-alerts`: « rule 13: active and alerting, the weather step shows before the recap » fails |
| B5 | **The engine's own tests use real plugins as their subject, and count them.** « catalogue: sixteen plugins… », « rule 5: every moved route keeps its URL… », « rule 8: the jobs keep today's intervals… », the erasure tests (weather-alerts, school-holidays, gate-access); client « rule 2: the modules are listed once » and `settingsIntegrations.contributions` deep-equal the full list. | `tests/plugins-phase-0.unit.test.js`, `tests/plugins-phase-1-sdk.unit.test.js`, `tests/plugins-setup-state.unit.test.js`, `client/src/plugins/sdk/__tests__/registry.test.jsx`, `settingsIntegrations.contributions.test.js` | sandbox without `weather-alerts`: 16 engine subtests fail; without `school-holidays`: 9 |
| B6 | **Latent — a payment link re-offered without the payment plugin.** `deposit_reminder` (and an installment request's `openLinkUrl`) inject the stored open link whether or not `online-payment` is live. The blocker prevents a deliberate deactivation while a link is open, but not the other ways a plugin stops being live: register failure, package missing/incompatible, licence. The guest then receives a Qonto link nobody polls or reconciles. Not reproduced on the shadow (its open links are `full`, the reminder looks for `deposit`). | `server/src/controllers/emailsController.js:144-158` | code reading |

The suites were run at concurrency 5 with one SQLite file per test process (§7.4); 35 server and 55
client failures exist in the untouched baseline sandbox (missing `integrations/`, `control-plane/`
and machine load) and are excluded from the diffs above.

## 2. Goal

Any plugin can be deactivated, uninstalled (with or without its data) or left out of the code, and
the core and the other plugins keep working — proved every night and on demand, for every plugin,
including the ones added later.

## 3. Functional rules

### 3.A Fixes

1. **The catalogue survives a missing plugin folder.** `PLUGIN_CATALOG` is built from the manifests
   that exist: an id of `CATALOG_ORDER` whose `manifest.json` is missing or invalid is left out with
   one log line `[plugins] <id>: manifest introuvable, plugin ignoré` — never a boot failure. The boot
   (`host.boot`) passes to `loadPackages` the catalogue ids **plus** the ids of `plugins` rows outside
   it, so an installed plugin whose code is gone is reported `PACKAGE_MISSING` (« Paquet introuvable :
   à réinstaller. », phase 4 rule 14) under the name its row's stored manifest carries (else its id),
   and can be uninstalled. Nothing else changes for a shipped plugin.
2. **No record, not live — in every mode.** `registry.isLive(id)` is false for an id with no registered
   record, in `sources` as in `packages` mode (`requireRecord` becomes the default). Unit suites that
   probe `isLive` without registering a module register a fixture record or configure the registry
   explicitly. Consequently `/api/auth/me` never lists a plugin whose module is not loaded.
3. **A core test never imports a plugin folder.** A test under `server/src/tests/` or a core client
   test (`client/src/**/__tests__/` outside `client/src/plugins/<id>/`) imports no
   `plugins/<id>/` path. Each existing case is resolved one of three ways, chosen per file:
   (a) the test is about the plugin's logic → it moves to `plugins/<id>/tests/` (or `__tests__/`)
   unchanged; (b) it is about the core and used the plugin as a convenient subject → it uses the SDK
   fixture plugin (rule 5); (c) it proves a real collaboration → rule 4.
4. **A test that needs two plugins says so.** A test proving a collaboration between plugins
   (`sas` hosting `hourly-resources`/`weather-alerts`/`linen`/`gate-access` steps, `neat` offered by
   `website-booking`, `google-vacation-rentals` fed by `tariff-recipes`, the dashboard attention of
   several plugins) opens with `requirePlugins(['a', 'b'])` (server: `plugins/sdk/testing.js`; client:
   `plugins/sdk/testing.js`), which skips the whole file — named in the output as
   `skipped: requires <id>` — when one of them is not shipped. Outside such a file, a plugin's tests
   import nothing from another plugin's folder.
5. **The engine is tested on a fixture, not on real plugins.** The plugin-engine suites
   (`plugins-phase-0`, `plugins-phase-1-sdk`, `plugins-phase-4-registry`, `plugins-setup-state`,
   `hosting-h2-support-*`, client `plugins/sdk/__tests__/*`) exercise mount, gate, jobs, settings,
   secrets, erasure and role access on fixture modules (`server/src/plugins/sdk/fixtures/`,
   `client/src/plugins/sdk/fixtures/`), never on `weather-alerts`, `school-holidays`, `gate-access`…
   Any assertion about « the plugins » (count, ids, order, contributions) compares to the list the
   folders give (rule 13's `listPlugins()`), never to a literal.
6. **A payment link is offered only while a payment provider is live.** `deposit_reminder` and an
   installment request inject `paymentLink` / `hasPaymentLink` only while `online-payment` is live;
   otherwise the template's `{{#if hasPaymentLink}}` fallback is used, whatever links are stored.
   The stored links are untouched (they reappear when the plugin is live again).

### 3.B The guarantee in CI

7. **One removal job per plugin, nightly and on demand.** A workflow `plugin-removal.yml` (`schedule` +
   `workflow_dispatch`, never a pull-request trigger — Resolved 2026-10-28, Q1) runs a matrix
   with one cell per plugin. A cell starts from the checkout, builds the **seeded database with every
   plugin present** (rule 11), then removes the plugin `P` — its server and client folders and its
   lines in both module lists (`node scripts/plugin-removal.mjs remove P`) — and runs, in order:
   (a) the server suite (`npm test`, with P's tests gone and rule 4's files skipped); (b) the client
   production build and the plugin packages (`vite build`, `build-plugin-packages.mjs` — P has no
   package); (c) the production server on the seeded database (`GUESTFLOW_PLUGINS=packages`), where
   P's row is still installed, so P is reported `PACKAGE_MISSING`; (d) the removal E2E (rules 8–10).
   The cell is named `removal: <P>`. The matrix is **not blocking**: it gates no pull request; a failing
   cell fails the nightly run, which opens or updates one issue (rule 15's alert), and anyone can run it
   against a branch from the Actions tab before merging a risky change.
8. **Boot and health.** In the removal E2E, the server answers `GET /api/version` 200 within 60 s,
   logs no `register failed`/`migration failed` for a plugin other than P, and `GET /api/plugins`
   lists P with `incompatible.code = 'PACKAGE_MISSING'` and every other plugin `active`.
9. **API contract smoke.** Logged in as the admin, each endpoint of the core contract list
   (`e2e/removal/coreContract.js`: dashboard, reservations list and one fiche of rule 11, calendar,
   planning, clients, devis, finance summary and tourist tax, emails list and preview of each guest
   template on the seeded stays, properties, options & resources, settings, users, the plugins list)
   answers 200 with its documented top-level keys; no endpoint answers 5xx. The core's scheduled passes
   (`performAutoSync`, `runArrivalDeparturePushPass`, `runBreakfastPushPass`, the email auto-send and
   guest-sequence passes, the digest flush) are run once through a test-only trigger and none throws.
10. **Pages smoke.** In a headless Chromium, each core page of the bare suite's list (phase 0 rule 28)
    plus the fiches of rule 11 renders its `main`, raises no page error and no error boundary, makes no
    `/api` call answered 5xx, none answered `404 PLUGIN_INACTIVE` and none under P's API prefixes (read
    from its manifest-adjacent route list, rule 13), and shows no link to P's pages. P's pages typed by
    hand show « Cette page dépend du plugin « <nom> », qui n'est pas activé. » (phase P rule 42). Every
    other plugin's main page still renders. Desktop 1280 px and phone 390 px.
11. **The seed carries every plugin's data.** `server/scripts/seed-plugin-data.js` builds, on the E2E
    database, one direct stay and one platform stay that carry each plugin's data: a per-hour session
    and an external resource booking, a paid and a cancelled payment link and a bank transaction
    reconciled to the stay, a gate key result, a Neat subscription, laundry skips/additions, a Booking,
    Airbnb and Gîtes de France intake applied to the platform stay, a tariff recipe applied and a run,
    a school holiday, a weather cache row, a public request and its CGV acceptance. Each plugin owns its
    part in `plugins/<id>/tests/removalSeed.js` (`seed(db, { stays })`, `rows(db)` → `{ table: count }`);
    the script runs every shipped plugin's seed before any removal. A plugin with nothing to seed
    exports `seed: null` with a one-line reason.
12. **Data left behind is harmless.** On the removal cell's server, for each fiche of rule 11:
    `GET /api/reservations/:id` answers 200; a save that changes nothing (`PUT` of the payload the
    fiche loaded) answers 200 and leaves the stay's money identical to the cent — `finalPrice`,
    acompte, solde, tourist tax, every option and resource line with its quantity, price and sessions —
    and leaves P's rows untouched (P's `rows(db)` before = after). Its emails' previews render, carry no
    `{{…}}` left unreplaced, and carry no link that only P could serve (rule 6 for payment links).
13. **A new plugin is in the matrix by construction.** The matrix is not written by hand: a first job
    runs `node scripts/plugin-removal.mjs list`, which returns every folder of `server/src/plugins/`
    holding a `manifest.json` (sorted), and the matrix is `fromJSON` of it. A guard unit test
    (`server/src/tests/plugin-removal-matrix.unit.test.js`) asserts that this list equals `PLUGIN_IDS`
    and the folders of `client/src/plugins/` (minus `sdk`), that `remove P` on a temporary copy leaves
    two module lists that still parse and no longer name P, for every P, and that every plugin has its
    `removalSeed.js`. A new plugin therefore gets its cell, its seed and its checks in the PR that adds
    it, or that PR fails.
14. **A plugin another one requires is removed with it.** `remove P` also removes the plugins whose
    manifest `requires` P, transitively (`website-booking` takes `google-vacation-rentals` with it), and
    prints them; the cell's checks apply to all the removed ids.
15. **Deactivated, uninstalled, purged, back: one nightly sweep job.** A job `plugin toggle sweep` (same
    workflow, nightly and on demand, **not blocking**; on failure it opens — or comments on — one issue
    titled « Plugin removal matrix failing », Resolved 2026-10-28, Q2; sharded in 2 by plugin index) starts the production server on the rule 11 database with
    every plugin, and for each plugin P, through the real API: (a) deactivate → the pages smoke of
    rule 10 on the core pages and the fiches; (b) activate → P's own pages render and P's API answers
    again, P's `rows(db)` unchanged; (c) uninstall keeping data → restart → pages smoke; reinstall →
    restart → P's `rows(db)` equal to (a)'s and P's pages show them; (d) when P is erasable: uninstall
    with purge → restart → pages smoke → reinstall **without** a restart → P's pages render empty and
    its API answers (no statement prepared on a dropped table) → restart → same.
16. **Blockers and requirements are part of the sweep.** For `online-payment` (an open link),
    `sas` (an « Accueil » account) and `accounting-export` (a « Comptable » account), the sweep first
    asserts the `409 PLUGIN_BLOCKED` with its code, then clears the cause through the API (cancel the
    link, change the role) and goes on. For `website-booking` it asserts `409 REQUIRED_BY` while
    `google-vacation-rentals` is active, then deactivates the dependent first.
17. **Re-enabled plugins catch up from their own state.** In step (b) of rule 15, the plugin's jobs run
    once through the test trigger: none throws, and the plugins that react to events
    (`google-calendar`, `neat`, `google-vacation-rentals`) show, on fakes, that a reservation changed
    while they were off is handled by that pass (reconcile, scan, full push) — not lost.
18. **Fast enough to run nightly in parallel.** A removal cell stays under 12 minutes and a sweep shard
    under 15 on GitHub-hosted runners (`ubuntu-latest`, never `self-hosted`). The server suite of a cell
    runs as `npm test` does today — serial, about 3½ minutes for 7 700 tests — so no per-process
    database preload is needed; the matrix runs with `max-parallel: 8`. Nothing in it queues behind, or
    starves, the pull-request checks, since it does not run on them.

**Edge cases:**
- A plugin folder exists on one side only (server without client, or the reverse) → rule 13's guard
  fails with the id and the missing side.
- A plugin's `removalSeed.js` throws → the seed script fails the cell that runs it, naming the plugin;
  it never silently seeds less.
- A cell fails only because the external world is unreachable (Qonto, Neat, Météo-France, Google) →
  impossible by construction: the servers of the removal E2E point every provider base URL at a dead
  local port, as the shadow copies do, and the smoke ignores nothing else.
- Two plugins removed at once → not a matrix cell (16 × 15 cells); the bare suite already proves
  « all removed », rule 14 proves the chained case.

---

## 4. Architecture

> Fat backend, thin frontend: nothing of this spec runs in the browser except the E2E driver. The fixes
> are server-side (catalogue, registry, email context) and in the test layout.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | `emailsController.js` | T | Rule 6 — payment link injected only while `online-payment` is live |
| `controllers/` | `pluginsController.js` | T | Rule 1 — lists an installed id outside the catalogue (name from its row's manifest) |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | `plugins.js` | T | Rule 1 — catalogue from the manifests that exist, one log line per missing id |
| `plugins/` | `host.js` | T | Rules 1–2 — `order` = catalogue ∪ installed rows; `requireRecord` in both modes |
| `plugins/sdk/` | `registry.js` | T | Rule 2 — `requireRecord` true by default |
| `plugins/sdk/` | `testing.js` | T | Rule 4 — `requirePlugins(ids)`; rule 13 — `listPlugins()` |
| `plugins/sdk/fixtures/` | `fixture-a/`, `fixture-b/` | C | Rule 5 — two minimal modules (routes, job, settings with a secret, a table, an erasure, a role entry) for the engine suites |
| `plugins/<id>/tests/` | `removalSeed.js` (×16) | C | Rule 11 — the plugin's part of the seed and its `rows(db)` |
| `plugins/<id>/tests/` | moved test files | T | Rule 3(a) — the core tests that were about the plugin's logic |
| `tests/` | 40 files | T | Rules 3–5 — moved, rewired on the fixture, or wrapped in `requirePlugins` |
| `tests/` | `plugin-removal-matrix.unit.test.js` | C | Rule 13 guard |
| `tests/` | `plugin-removal-fixes.unit.test.js` | C | Rules 1, 2, 6 |
| `scripts/` (server) | `seed-plugin-data.js` | C | Rule 11 — runs every shipped plugin's seed on the E2E database |
| `scripts/` (server) | `test-isolated-db.js` | C | Rule 18 — preload: one SQLite file per test process |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Rule 9 — exports the remaining passes (email auto-send, guest sequence, digest) for the test trigger; no behaviour change |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `__tests__/Dashboard.server-today.test.jsx`, `Dashboard.beds-empty.test.jsx`, `settings/__tests__/TermsSettingsPage.test.jsx` | T | Rule 3 — no plugin import (fixture module, or moved into the plugin) |
| `plugins/sdk/` | `testing.js` | C | Rule 4 — `requirePlugins(ids)` for Vitest (`describe.skipIf`) |
| `plugins/sdk/fixtures/` | `fixtureModule.jsx` | C | Rule 5 — a fixture client module (route, slot, settings section) |
| `plugins/sdk/__tests__/` | `registry.test.jsx`, `settingsIntegrations.contributions.test.js` | T | Rule 5 — compare to the shipped folders, not to a literal |
| `plugins/sas/__tests__/` | `ReservationSasDialog.plugins.test.jsx` | T | Rule 4 — `requirePlugins(['sas', 'weather-alerts', …])` per collaboration |
| `components/`, `hooks/`, `services/`, `utils/`, `constants/`, `api.js` | — | — | (none) |

**Component reuse declaration:** no component is created or changed. The Plugins page already renders
the `PACKAGE_MISSING` state (phase 4 rule 14) with `StatusBadge`; rule 1 only feeds it one more case.

### 4.3 Repository, CI and E2E

| Area | File | T/C | Responsibility |
|---|---|---|---|
| `scripts/` | `plugin-removal.mjs` | C | `list` (rule 13), `remove <id>` with requirement cascade (rules 7, 14), `routes <id>` (P's API prefixes, rule 10) |
| `.github/workflows/` | `plugin-removal.yml` | C | Jobs `list`, `removal: <id>` (matrix), `plugin toggle sweep` (2 shards) — rules 7, 13, 15, 18 |
| `e2e/removal/` | `removal.spec.js`, `coreContract.js` | C | Rules 8–10, 12 |
| `e2e/removal/` | `toggle-sweep.spec.js` | C | Rules 15–17 |
| `e2e/removal/` | `serve.js` | C | Production server on the seeded DB, providers on a dead port, test trigger for the passes |
| root | `playwright.removal.config.js` | C | Its own DB path, `E2E_SEED_PLUGINS` = all, `REMOVED_PLUGINS` env, report `playwright-report-removal` |
| root | `package.json` | T | `test:e2e:removal`, `test:e2e:sweep` |

### 4.4 API contract

No public or `/api` endpoint changes. Two observable differences:

| Endpoint | Before | After |
|---|---|---|
| `GET /api/plugins` | an installed id outside the catalogue is not listed | listed with `state: 'installed'`, `incompatible: { code: 'PACKAGE_MISSING', message: 'Paquet introuvable : à réinstaller.' }`, only « Désinstaller » offered |
| `GET /api/auth/me` (`sources` mode only) | `enabledPlugins` may name an installed plugin with no module | only plugins with a registered, live module |

The test-only trigger of the scheduled passes is not an HTTP route: `e2e/removal/serve.js` loads the
server in-process with `GUESTFLOW_TEST_TRIGGERS=1` and exposes the passes on its own control port, like
`e2e/prod/serve.js` exposes `/__control/restart`. `utils/testOnlyKeys.assertNoTestOnlyKey` refuses the
variable in production.

---

## 5. Data model

No schema change, no migration. Rules 11–12 read and write only the E2E database. Rule 1 reads the
`plugins.manifest` column that phase 4 already stores.

**Data impact:** none on real data. Rule 6 changes what a reminder email contains only while
`online-payment` is not live — the case where the link must not be offered.

## 6. UI / UX

No screen changes. The only visible effect: an installed plugin whose code is gone appears on the
Plugins page in the existing « Paquet introuvable : à réinstaller. » state (rule 1) instead of being
invisible. Mobile: unchanged, the Plugins page already stacks its cards on `xs`; the rule 10 smoke
checks every page at 390 px as well as 1280 px.

## 7. Test plan

Every new rule (1–18) is cited by at least one test (spec-rules CI).

### 7.1 Server unit tests
- [ ] `tests/plugin-removal-fixes.unit.test.js` — rule 1 (catalogue without a folder: no throw, the
  log line, an installed orphan listed `PACKAGE_MISSING` with its stored name), rule 2 (no record →
  not live in `sources` and `packages`; `/api/auth/me` omits it), rule 6 (reminder and installment
  request without the live provider fall back; with it, the link) — 9 cases.
- [ ] `tests/plugin-removal-matrix.unit.test.js` — rule 13 (list = `PLUGIN_IDS` = client folders;
  `remove P` for every P leaves parseable lists; every plugin has `removalSeed.js`), rule 14 (cascade
  of `requires`), rules 3–4 (static: no `src/tests/**` file and no core client test imports
  `plugins/<id>/`; a plugin test importing another plugin's folder only inside a `requirePlugins`
  file) — 7 cases, one of them parametrised over the 16 plugins.
- [ ] `plugins/sdk/fixtures` exercised by the rewired engine suites — rule 5 (the existing cases keep
  their count; their subject changes).
- [ ] `plugins/<id>/tests/removal-seed.unit.test.js` ×16 — rule 11 (the seed writes, `rows` counts it,
  on a fresh database) — 1 case each.

### 7.2 Client unit tests
- [ ] `plugins/sdk/__tests__/testing.requirePlugins.test.js` — rule 4 (skips when absent, runs when
  present) — 2 cases.
- [ ] `plugins/sdk/__tests__/registry.test.jsx` — rule 5 (list from the folders) — existing case rewired.

### 7.3 E2E
- [ ] `e2e/removal/removal.spec.js` — rules 8, 9, 10, 12 — 4 tests per cell (boot/health, contract,
  pages desktop + phone, data left behind).
- [ ] `e2e/removal/toggle-sweep.spec.js` — rules 15, 16, 17 — 1 test per plugin, sharded.
- [ ] The existing smoke, bare and production-build suites stay green.

### 7.4 Reproducing the 2026-10-28 measurement
The scripts that produced §1.3 are the prototype of rules 7–15: a packages-mode server on a copy of the
shadow, a 40-page headless sweep (page errors, console errors, `/api` ≥ 400, error boundary), the
deactivate → reactivate → uninstall → restart → reinstall → restart loop per plugin, and a sandbox copy
per plugin with its folders removed running both suites with one SQLite file per test process
(`NODE_OPTIONS=--require <preload>` setting `DB_PATH` per `process.pid`). They are rewritten as the
committed files of §4.3; nothing of the scratchpad is committed, and no real guest name is.

### 7.5 Manual verification
- [ ] Run the workflow from the Actions tab: the `removal: <id>` cells appear, one per plugin, and are green.
- [ ] Add a throw-away plugin folder on a branch: its cell appears without touching the workflow, and
  the guard fails until it has its `removalSeed.js` (rule 13).
- [ ] Break a core page on purpose for one plugin's absence (e.g. call its API unconditionally): only
  that plugin's cell fails, naming the page and the call.
- [ ] Mobile: the pages smoke screenshots at 390 px of a failing cell are in its report.

## 8. Out of scope

- Removing two or more plugins in every combination (the bare suite covers « all », rule 14 the chained
  case).
- The external consumers of a removed plugin: the WordPress plugin talking to a `/public/v1` without
  `website-booking`, the house calling `/public/v1/gate` without `gate-access`, the operator's
  userscript without `booking-intake`. They receive `404 PLUGIN_INACTIVE` today; what each shows is the
  consumer's spec.
- Refactoring the hard-coded ids that are gated by `isLive` (`PLUGIN_PRICE_TYPES`, `ROLE_PLUGINS`,
  `PLUGIN_OF_TEMPLATE`, `PLUGIN_PAGES`, `publicPaymentController.js:81`…): they are the inert bricks the
  SDK expects, and the matrix is what proves them harmless.
- Third-party plugins from the registry that are not in `CATALOG_ORDER` (phase 4 scope).
- The client unit suite per cell: replaced by rules 3–5's static guard (a core client file importing a
  plugin is the only way the client suite could break on a removal) and by rule 10, which compiles and
  renders the client without the plugin.

## 9. Open questions

None open.

### Resolved 2026-10-28

- **Q1 — When do the 16 cells run?** Nightly plus on demand (`workflow_dispatch`), **not blocking** pull
  requests. Rule 7 rewritten; rule 18 rewritten (the 12-minute budget is per cell, nightly).
- **Q2 — Is the toggle sweep blocking?** No: nightly with an alert — one issue opened or updated on
  failure. Rule 15 rewritten.
- **Q3 — `requireRecord` in `sources` mode (rule 2).** Default as written: the unit suites it exposes are
  fixed in the same PR (see §10).
