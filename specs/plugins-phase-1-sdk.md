# Plugins — phase 1: the plugin SDK, and five plugins moved out of the core

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugins-phase-1` (from `inte/plugins`) |
| **Created** | 2026-09-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened; target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §6 extension points, §8.2, phasing §12 |
| **Previous phase** | [`specs/plugins-phase-0-foundation.md`](plugins-phase-0-foundation.md) (merged into `inte/plugins`, #629) |
| **Summary for review** | [`docs/specs/2026-09-28-plugins-phase-1-sdk.html`](../docs/specs/2026-09-28-plugins-phase-1-sdk.html) |

---

## 1. Context

Phase 0 gave the 12 built-in plugins an on/off switch and hid every entry point of a plugin that is not
active. The code of each plugin still lives inside the core. The core imports it by name, keeps its
tables in `schema.sql`, its settings in `app_settings` columns and its jobs in `scheduledTasks.js`, and
calls it by hand after every reservation write. Phase 0 guards all of it with `requirePlugin`,
`whenPluginActive`, `usePlugin` and `PluginGate`, one call site at a time.

Phase 1 turns the direction around. The core exposes **extension points**, and a plugin **registers**
into them: its routes, tables, settings, jobs, event handlers, email variables and screen blocks. The
core no longer knows which plugins exist beyond one list of built-in modules.

The mapping of the five plugins chosen for this phase (the least entangled ones, study §12) found:

| Plugin | Server | Client | Couplings with the core |
|---|---|---|---|
| `weather-alerts` | 4 files, 463 lines; 1 table; 1 encrypted setting; no job | 2 files | 1 route inside the reservations router; the SAS weather step; the Intégrations section |
| `school-holidays` | 6 files, 595 lines; 2 tables; 11 seeded periods in `database.js`; hourly job | 9 files, 557 lines | mount; job; calendar day bands (month, week, pricing calendar); tab of Vacances & fermetures |
| `google-calendar` | 7 files, 1,040 lines; 8 `app_settings` columns (2 encrypted); 15-min job; `googleapis` | 1 file | **10 direct calls** after reservation writes (create, update, delete, cancel, iCal drift and cancellation approvals, devis conversion, payment conversion, iCal import) |
| `tariff-recipes` | 6 files + 2 bundled recipes; 1 table; daily job | 4 files | 3 routes inside the properties router; recipe card and banner of the property tariff; dashboard alert |
| `gate-access` | 9 files, 1,084 lines; 2 tables; 2 secrets in `.env.local` | 4 files | public mount `/public/v1/gate`; 4 email paths; SAS payload; fiche card; dashboard alert |

It also found **four server paths of `gate-access` that still run when the plugin is off**: the dashboard
endpoint `GET /api/dashboard/gate-keys`, the gate fields of the SAS payload, the gate variables of the
guest emails, and the two connector secrets generated at every boot. The client hides all of them; the
server does not. Moving the plugin behind the SDK closes them structurally.

Owner's decisions (2026-09-28, questionnaire):

- **P1** — plugin code lives in `server/src/plugins/<id>/` and `client/src/plugins/<id>/`. The release
  archive, the updater and both test runners already reach these paths. A test forbids a plugin from
  importing the core except through the SDK, so moving each plugin into its own package later
  (phase 4) is a copy, not a rewrite.
- **P2** — one pull request for the whole phase, onto `inte/plugins`.
- **P3** — plugin settings move to a **per-plugin settings table**. Secret values are copied as they
  are, still encrypted with the same key.
- **P4** — uninstalling one of the five moved plugins offers **« Effacer aussi ses données »** from
  this phase on. The seven plugins still in the core keep the phase 0 behaviour: their data is always
  kept.

## 2. Goal

Nothing changes for the person using GuestFlow, apart from two fixes and one new choice. The five
plugins keep working exactly as before and disappear exactly as before. What is new: uninstalling one of
them can erase its data, the portal code shows in the SAS without Sowel, and the Google connection
message shows again. Behind that, the core has a documented plugin contract. The other seven plugins
move into it in phases 2 and 3, and plugin downloads arrive in phase 4.

## 3. Functional rules

### 3.A A plugin module

1. A plugin is a folder `server/src/plugins/<id>/` whose `index.js` exports `{ id, register(ctx) }`. It
   may have a client counterpart `client/src/plugins/<id>/index.js` exporting `{ id, contributes }`.
   Both folders hold every file of the plugin: routes, controllers, models, utils, components and tests.
2. The core knows plugin modules through **one list per side**: `server/src/plugins/index.js` and
   `client/src/plugins/index.js`. The catalogue of names, descriptions and surfaces stays in
   `constants/plugins.js` for the 12 plugins. `GET /api/plugins` says which ones have a module
   (`hasModule`), from the registry of registered modules.
3. **Isolation.** A plugin file imports only these:
   - files of its own folder;
   - the SDK (`server/src/plugins/sdk/` on the server, `client/src/plugins/sdk/` on the client);
   - npm packages;
   - on the client, the shared UI kit: `components/` for generic components and `api` for the HTTP
     client, both exposed through the client SDK.

   The core never imports a file under `plugins/<id>/`. The exceptions are the plugin list itself
   (rule 2) and the host side of the contract: the SDK and, on the server, the loader. Tests are exempt:
   they reach into both on purpose. A test walks the imports, on each side, and fails on any other
   import.
4. **A plugin that fails to register** (it throws in `register`) is logged with its id and reported
   `state: 'failed'` on the Plugins page, with the message « Ce plugin n'a pas pu démarrer. ». The
   server boots anyway, and the plugin's routes answer 404 `PLUGIN_INACTIVE`.

### 3.B What `register(ctx)` offers — server extension points

5. **Routes** — two forms, both mounted behind `requirePlugin(id)`, the session guard and the role
   guard:
   - `ctx.mount(prefix, router, { public })` for a prefix the plugin owns: `/api/school-holidays`,
     `/api/google-calendar`, `/api/tariff-recipes`. Only paths under `/api/` are accepted, or under
     `/public/` with `public: true`, which mounts outside the `/api` guards and before the generic
     `/public/v1` tree. `gate-access` (`/public/v1/gate`) is the only public mount.
   - `ctx.route(method, fullPath, ...handlers)` for a single route under a core prefix. Mounting a
     router at `/api/reservations` behind `requirePlugin` would answer 404 to every reservation call
     while the plugin is off, so these routes are registered one by one:
     - `/api/reservations/:id/weather-alerts` (`weather-alerts`);
     - `/api/properties/:id/tariff-recipe/*` (`tariff-recipes`);
     - `/api/reservations/:id/gate-access`, `/api/dashboard/gate-keys` and
       `/api/settings/gate-connector[/secrets]` (`gate-access`).
   - The paths stay **the current ones**, because some are external contracts: `/public/v1/gate` is
     read by Sowel, and `/api/google-calendar/oauth/callback` is registered in the Google console.
   - `ctx.reception([{ method, re }])` adds allowlist entries for the reception role.
     `enforceRoleAccess` reads them next to its own list. An entry of an inactive plugin still ends
     in the route's 404.
6. **Tables** — `ctx.migrations([{ name, up(db) }])`:
   - Migrations run in order, **for an installed plugin only**: at boot, and at install time before the
     plugin becomes active.
   - Each migration is recorded in the existing `migrations` ledger as `plugin:<id>:<name>`, and runs
     once.
   - Every `up` must be idempotent (`CREATE TABLE IF NOT EXISTS`). On Solio's database the tables
     already exist, so the migrations are no-ops there.
   - A plugin creates **its own tables only**. It never adds a column to a core table in this phase. The
     recipe columns already on `properties` and `pricing_rules` stay declared by the core, which reads
     them for pricing.
7. **Settings** — `ctx.settings.declare([{ key, secret?, default? }])`, then `ctx.settings.get(key)` and
   `ctx.settings.set(key, value)`:
   - Values live in `plugin_settings` (§5). A secret is encrypted with the same AES-256-GCM helper and
     key as `app_settings`.
   - The generic endpoints `GET/PUT /api/plugins/:id/settings` read and write the declared keys. A
     secret is never sent back to the client: it reads `{ <key>Set: true|false }`. On a write, an empty
     draft keeps the stored value, and `null` clears it, as in the rest of the settings. An undeclared
     key → 400 `UNKNOWN_SETTING`.
   - The Météo-France card of Intégrations writes its key there. It has no Save of its own: the
     page's bar saves it, like the Neat card.
8. **Scheduled jobs** — `ctx.jobs.every({ name, intervalMs, bootDelayMs, run })`:
   - The core runs `run` on its interval **only while the plugin is active**, with the phase 0 wrapper.
   - An error is caught and logged with `[plugin:<id>:<name>]`.
   - The job's intervals and boot delays stay what they are today:

     | Job | Interval | Boot delay |
     |---|---|---|
     | school holidays | 1 h | 60 s |
     | Google | 15 min | 130 s |
     | recipes horizon | 1 day | 140 s |
     | gate stale read | 1 h | 160 s |
9. **Events** — `ctx.events.on(name, handler)`:
   - The core emits these events after the write is committed:

     | Event | Payload | Emitted by the core instead of today's direct calls |
     |---|---|---|
     | `reservation.created` | `{ reservationId }` | reservation create, devis conversion (by hand, or by the payment of its link) |
     | `reservation.updated` | `{ reservationId }` | reservation update, iCal date-drift approval |
     | `reservation.cancelled` | `{ reservationId }` | cancellation, iCal cancellation approval |
     | `reservation.deleted` | `{ reservationId }` | reservation delete |
     | `ical.imported` | `{ created, updated, removed }` | iCal import that changed at least one booking |

   - A handler runs only while its plugin is active. It runs asynchronously, after the response, and
     never delays or fails the write that emitted it. Its errors are caught and logged per plugin.
   - Neat's own direct calls (`kickPass`) stay as they are: Neat moves in phase 3. The bus is built so
     that Neat can subscribe to the same events then.
10. **Email variables** — `ctx.emailContext({ tokens, flags, build(reservationId) })`:
    - `tokens` lists the variables the plugin adds, with a label for each (`gateAccessCode`,
      `gateAccessUrl`), and `flags` its conditions (`hasGateAccess`). `build` returns
      `{ tokens, flags }`.
    - The email context builder merges `build()` from **active** plugins only. An inactive plugin's
      variables render empty, and its `{{#if}}` blocks read false.
    - The four email paths (preview, auto-send, guest sequence, manual send) all go through the builder,
      so they no longer call gate code.
11. **Core services** — what a plugin needs of the core, in one reviewed place:
    - `ctx.core` (`plugins/sdk/coreServices.js`), the running app's services: a reservation with its
      details, the company address, the public URL, push sending, the text formatters;
    - the server SDK (`plugins/sdk/index.js`), for plugin files: the same `core`, core models bound to
      a given database (properties, closures, the tariff change journal — the recipe model runs on
      `ctx.db` in production and on an in-memory database in tests), the pricing and public-holiday
      helpers, the admin role, the public-API rate limit and the `.env.local` secrets.

    `ctx.db` is the database handle. The plugin's own models write its own tables through it, and may
    read core tables (Google reads the stays it pushes; the gate reads the stays it keys). A write to
    a core table goes through a core model. `ctx.log` prefixes `[plugin:<id>]`. Three more hooks:
    `ctx.onInstall(fn)` runs after an install's migrations, `ctx.onBoot(fn)` at every boot while
    installed, and `ctx.sasData(fn)` adds a block to the SAS payload (rule 17).
12. **Data erasure** — `ctx.data({ tables, describe(), purge(db) })`:
    - `describe()` returns what would be erased, as lines of `{ label, count }`, e.g. « 34 périodes de
      vacances ».
    - `purge` erases the plugin's data in one transaction:
      - it drops its tables;
      - it deletes its `plugin_settings` rows;
      - it deletes its `plugin:<id>:*` ledger rows, so a reinstall starts clean;
      - it runs any extra clean-up the plugin needs (rule 20).

### 3.C What `contributes` offers — client extension points

13. A client module contributes to **named slots**. The core renders `<Slot name="…" />` where the
    phase 0 code had a `PluginGate` or a `usePlugin` branch, and the slot renders the contributions of
    active plugins only. The slots of this phase:

    | Slot | Where | Filled by |
    |---|---|---|
    | `routes` | `App.jsx` `<Routes>` | school-holidays (`/school-holidays`), tariff-recipes (`/parametres/recettes`) |
    | `settings.menu` | settings menu, after the entry named by `after` | tariff-recipes (Recettes tarifaires) |
    | `settings.integrations` | Intégrations page sections, ordered around the Neat card | google-calendar, weather-alerts, gate-access |
    | `dashboard.alerts.urgent` | Dashboard alert stack, under the payment deadlines | gate-access (keys) |
    | `dashboard.alerts` | Dashboard alert stack, under the new iCal reservations | tariff-recipes (runs) |
    | `reservation.cards` | reservation page, after the finance section | gate-access |
    | `sas.arrival.steps` | SAS dialog, just before the recap | weather-alerts |
    | `sas.portal` | the SAS « Portail » step, when the SAS data says the plugin holds a key (rule 17) | gate-access |
    | `calendar.dayMarkers` | month view, week view, property pricing calendar, their legends | school-holidays |
    | `closures.tabs` | Vacances & fermetures, before « Fermetures » | school-holidays |
    | `property.tariff` | pricing seasons page | tariff-recipes (the recipe card) |
    | `emailTemplates.tokens` | token picker of the email templates page | gate-access |

    The season badge (« recette · … » / « Manuelle ») and the recipe banner and column of the property
    tariff tab stay core: they display core data (`seasonKey`, the extra-guest fields) and only ask
    whether the plugin is active, as phase 0 does for the seven other plugins. The core may ask that
    question; it never imports plugin code.

14. A contribution is a lazily loaded React component (`React.lazy`). A plugin's code is only downloaded
    by the browser when one of its slots renders. The order inside a slot is declared by the
    contribution's `order`. A slot that needs data rather than markup takes a plain function:
    `load()` for the calendar markers (it returns `markersFor(dateStr)` → `[{ key, color, title }]`) and
    `load({ reservationId })` + `isShown(data)` for a SAS step. The core only draws dots and steps.
15. The phase 0 route guard (`ROUTE_PLUGINS`, `pluginRoute`, the redirect of a hidden URL) now reads the
    routes contributed by modules. Hand-written entries remain only for the seven plugins without a
    module.
16. The client SDK (`client/src/plugins/sdk/`) re-exports what a plugin may use: `api` (the HTTP
    client), `useAuth`, `usePlugin`, the dialogs and toasts, the generic components (`PageActionBar`,
    `StatusBadge`, `EmptyState`, `ConfirmDialog`, `FormDialog`, `LoadingState`, `ErrorAlert`,
    `SummaryItem`, `MaskedTextField`, `SecretRevealField`, `SasKeypadCode`) and `displayDate`. The HTTP
    wrappers of the five plugins stay in the core `api.js` in this phase; they move with the plugin
    bundles in phase 4.

### 3.D Behaviour changes that come with the move

17. **The portal code belongs to the SAS, not to Sowel.**
    - The keypad code of the property (`portalCode`, Établissement) is a SAS fact. The SAS spec owns it.
    - Its field in Établissement is shown when **`sas`** is active, instead of `gate-access` in phase 0.
    - The SAS « Portail » step shows when the keypad code is filled **or** `gate-access` has a key for
      the stay. The SAS payload says the latter as `pluginData['gate-access'].available`, filled only
      while the plugin is live. The Sowel QR code and link are the gate-access contribution inside
      that step (slot `sas.portal`), with the keypad code as its fallback.
    - A customer without Sowel who types a keypad code now sees it in the arrival SAS. In phase 0 it was
      hidden.
18. **The gate connector secrets are created when the plugin is installed**, and at boot only if it is
    installed. A new customer who never installs `gate-access` has no connector keys. The keys stay in
    `server/.env.local`, where Sowel's configuration was copied from. Erasing the plugin's data does not
    rotate them.
19. **The Google connection message.** After the Google consent screen, the callback redirects to
    `/settings/integrations?google=<result>`, the page that shows the message. Today it redirects to
    `/settings?google=…`, whose redirect to Établissement drops the query string (confirmed in the code:
    the `<Navigate>` of `/settings` carries no search, and the message is read by the Intégrations
    card only).
20. **What « Effacer aussi ses données » erases, plugin by plugin:**

    | Plugin | Erased | Kept |
    |---|---|---|
    | `weather-alerts` | vigilance cache; the Météo-France key | — |
    | `school-holidays` | the holiday periods; sync state | — |
    | `google-calendar` | the connection (refresh token, calendar, sync state) | events already written in the Google calendar (outside GuestFlow) |
    | `tariff-recipes` | run history; the recipe attachment of each property (`tariffRecipeId`, `tariffRecipeVersion`); the `seasonKey` tag of seasons | every season, price, closure and welcome-pack cost: the seasons become manual (« Manuelle ») |
    | `gate-access` | key results and connector state | the keypad code (SAS, rule 17); the connector keys in `.env.local` (rule 18) |

    **Money never moves** (phase 0 rule 7). No erasure changes a price, a payment, a balance or an
    accounting entry. The tariff change journal is core data: it is never erased.

### 3.E Uninstall with erasure — the Plugins page

21. In the detail of an installed plugin that has a module (the five), above « Désinstaller », a
    checkbox **« Effacer aussi ses données »**, unticked by default.
    - **Unticked:** the phase 0 note, now shown as soon as the detail opens: « Tes données sont
      conservées : en le réinstallant, tu retrouves tout. »
    - **Ticked:** the note is replaced by « Seront effacés : » followed by the server's list (rule 12),
      e.g. « 34 périodes de vacances · l'état de synchronisation ». The note ends with « C'est
      définitif. », and the confirm button turns red with the label « Désinstaller et effacer ».
22. The seven plugins without a module show no checkbox. Their data is always kept, as in phase 0.
23. Erasure obeys the refusals of phase 0 rule 8. No refusal applies to the five plugins of this phase.
24. A reinstall after erasure runs the plugin's migrations again, so the tables come back empty. The
    reinstalled plugin starts like a new install:
    - `school-holidays` syncs from education.gouv at once (rule 26);
    - `google-calendar` asks to reconnect;
    - `weather-alerts` asks for its key.

### 3.F Existing databases, new customers

25. **Existing database (Solio):**
    - Tables are unchanged. The plugins' migrations only find tables that already exist.
    - The one-shot migration `plugin_settings_from_app_settings_v1` copies the Météo-France key and the
      eight Google fields into `plugin_settings`. Secret values are copied as they are, still encrypted.
    - The old `app_settings` columns stay in place and unread, and are dropped in a later release.
    - Nothing is visible to the user; Google stays connected and weather keeps its key.
26. **New database:** the five plugins' tables no longer come from `schema.sql` or `database.js`. They
    appear when the plugin is installed.
    - The 15 hard-coded school-holiday periods (2024–2027) are dropped. Installing `school-holidays`
      runs a sync at once, which fetches 24 months from education.gouv (rule 27).
    - If that first sync fails (offline), the tab shows the existing sync banner with its error, and
      manual entry works.

27. **The school-holiday sync reads the dataset as it is published** — found while checking rule 26:
    until now a sync imported the summer only, and Solio's calendar held its periods from the
    hard-coded seed.
    - **Every period:** the dataset marks most periods `population = "-"` (the same dates for
      everyone) and only splits `"Élèves"` from staff when they differ. Both are kept.
    - **Paris days:** the dataset gives instants. A period starts on the Paris day of `start_date`
      (the UTC date of `2026-10-16T22:00:00+00:00` is the Friday before the holidays), and ends the day
      before the Paris day of `end_date`, when classes resume. A single-day entry (a bridge, « Début des
      vacances d'été ») ends the day it starts.
    - **Hand-typed twins:** a manual period (never locked) is adopted instead of duplicated when its
      label matches, or when it names the same season (Toussaint, Noël, Hiver, Printemps, Pâques,
      Ascension, Été) and its dates overlap in at least one zone. The official label and dates replace
      the typed ones. A period already imported is updated in place and adopts nothing: a leftover
      manual row stays, for the operator to delete.

**Edge cases:**
- **A plugin throws during `register`.** Rule 4 applies: the other plugins and the core boot. The Plugins
  page shows « Ce plugin n'a pas pu démarrer. » and offers Désinstaller.
- **A migration fails at install time.** The install is refused, with 500
  `{ error: 'PLUGIN_MIGRATION_FAILED', plugin }`, and the plugin stays « Disponible ». The failed
  migration is not recorded in the ledger.
- **An event handler throws.** The error is logged and the write that emitted the event is already
  answered. Google's 15-minute reconcile catches up any stay that was not pushed, as it does today.
- **A plugin is deactivated while its job runs.** The run finishes, and the next tick is skipped
  (phase 0).
- **An erasure fails halfway.** The transaction rolls back and nothing is erased. The error is shown
  under the card, and the plugin stays installed and inactive.
- **The Google refresh token is revoked outside GuestFlow.** Nothing changes from today: the status
  shows the error and the admin reconnects.

---

## 4. Architecture

> **Fat backend, thin frontend.** The list of data to erase, the plugin states, the email variables and
> the step availability are computed on the server. The client renders slots and the confirmation.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `registry.js` | C | What each module registered; `isLive(id)` = installed, active and registered without throwing |
| `plugins/sdk/` | `createContext.js` | C | A plugin's `ctx`: mount, route, reception, migrations, settings, jobs, events, emailContext, sasData, onInstall, onBoot, data, core, db, log |
| `plugins/sdk/` | `eventBus.js` | C | `emit` after commit (async, isolated per handler, live plugins only); `emailContext(id)` and `sasData(id)` merge live contributions |
| `plugins/sdk/` | `coreServices.js` | C | `ctx.core`, the running app's services a plugin may call (rule 11) |
| `plugins/sdk/` | `index.js` | C | What plugin files may `require`: `core`, db-bound core models, pricing and holiday helpers, roles, the public-API limiter, `.env.local` secrets |
| `plugins/sdk/` | `pluginMigrations.js` | C | Runs a module's migrations against the `plugin:<id>:<name>` ledger; forgets them on erasure |
| `plugins/sdk/` | `testing.js` | C | `applyPluginSchema(db, id)` — a module's tables on a bare test database |
| `plugins/` | `index.js` | C | The list of built-in modules |
| `plugins/` | `loader.js` | C | `registerAll` (failure → failed state; migrations + boot hooks of installed modules), `migrate`, `runInstallHooks`, `mountPublic`, `mountApi`, `startJobs`, `receptionMatchers` |
| `plugins/weather-alerts/` | `index.js`, `controller.js`, `meteoVigilance.js`, `meteoVigilanceLabels.js`, `cacheModel.js`, `tests/` | C (moved) | Météo-France |
| `plugins/school-holidays/` | `index.js`, `routes.js`, `controller.js`, `model.js`, `sync.js`, `educationGouvClient.js`, `validation.js`, `tests/` | C (moved) | School holidays; the sync fixes of rule 27 |
| `plugins/google-calendar/` | `index.js`, `controller.js`, `model.js`, `sync.js`, `events.js`, `client.js`, `oauthClient.js`, `settings.js`, `tests/` | C (moved) | Google Agenda; `settings.js` gives the old accessors' API over `plugin_settings`; subscribes to the 5 events |
| `plugins/tariff-recipes/` | `index.js`, `controller.js`, `model.js`, `store.js`, `seasonPlan.js`, `horizon.js`, `recipes/*.json`, `tests/` | C (moved) | Recipes; the horizon pass left `scheduledTasks.js` |
| `plugins/gate-access/` | `index.js`, `controller.js`, `publicRoutes.js`, `requireConnector.js`, `signResponse.js`, `keysModel.js`, `keys.js`, `results.js`, `window.js`, `invitationView.js`, `emailContext.js`, `tests/` | C (moved) | Sowel connector; email variables; SAS data |
| `models/` | `pluginSettingsModel.js` | C | `plugin_settings`: get/set (secrets encrypted), raw, deleteAll, HTTP view |
| `models/` | `settingsModel.js` | T | Google and Météo columns out of `COLUMNS`, `ENCRYPTED_COLUMNS`, masks and accessors |
| `controllers/` | `pluginsController.js` | T | `failed` state, `hasModule`, `erasable`, `data`; migrations + install hooks on install; `DELETE ?purge=1`; settings endpoints |
| `controllers/` | `reservationsController.js`, `reservationCancellationController.js`, `dashboardController.js`, `devisController.js` | T | Events instead of Google calls; the gate endpoint left `reservationsController` |
| `controllers/` | `sasController.js` | T | `pluginData` instead of `gateAccess` |
| `controllers/` | `settingsController.js`, `emailsController.js` | T | `weather` group removed; email context from `eventBus.emailContext` |
| `utils/` | `emailContextBuilder.js` | T | `pluginContext` (`{ tokens, flags }`) instead of `gateInvitation` |
| `utils/` | `emailAutoSendRunner.js`, `guestEmailSequenceRunner.js`, `reservationEmailSender.js`, `paymentPollRunner.js` | T | Plugin email context; an event instead of the Google push |
| `utils/` | `pluginsSchema.js`, `settingsResponse.js`, `dbHygiene.js` | T | `plugin_settings` + copy migration; `weather` block and the school-holiday index removed |
| `utils/` | `pluginScheduling.js` | T | Checks `registry.isLive` |
| `middleware/` | `requirePlugin.js`, `enforceRoleAccess.js` | T | `registry.isLive`; plugin reception entries |
| `models/` | `propertyIcalModel.js` | T | `ical.imported` instead of the Google reconcile |
| `routes/` | `reservations.js`, `properties.js`, `dashboard.js`, `settings.js`, `plugins.js` | T | Plugin routes out; `GET/PUT /:id/settings` in |
| `scheduledTasks.js`, `index.js` | | T | The 4 plugin jobs, their mounts and the connector secrets move to the modules; the loader is called |
| `database.js`, `schema.sql` | | T | Tables of the five and the 15-period seed out of the baseline; `plugin_settings` in |
| `package.json` | | T | Test glob adds `src/plugins/**/tests/*.test.js` |
| `scripts/seed-e2e.js` | | T | Creates the modules' tables of the seeded plugins |

No new npm dependency. `googleapis` and `qrcode` stay in `server/package.json`.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `index.js` | C | What a plugin may import (rule 16) |
| `plugins/sdk/` | `registry.js`, `useSlot.js`, `Slot.jsx` | C | Contributions by slot; the active ones (`usePlugin` once per module); lazy rendering in place |
| `plugins/` | `index.js` | C | The list of client modules |
| `plugins/weather-alerts/` | `index.js`, `SettingsWeatherSection.jsx`, `SasWeatherAlertPage.jsx`, `sasStep.jsx`, `__tests__/` | C (moved) | The settings card saves through `/api/plugins/weather-alerts/settings`; the SAS step loads its alerts |
| `plugins/school-holidays/` | `index.js`, `SchoolHolidaysPage.jsx`, 5 components, `markers.js`, `holidayInfo.js`, `zoneColors.js`, `schoolYear.js` | C (moved) | Route, tab, calendar markers |
| `plugins/google-calendar/` | `index.js`, `SettingsGoogleCalendarSection.jsx`, `__tests__/` | C (moved) | |
| `plugins/tariff-recipes/` | `index.js`, `TariffRecipesPage.jsx`, `TariffRecipeCard.jsx`, `TariffRecipeRunsAlert.jsx`, `TariffChangeJournal.jsx`, `__tests__/` | C (moved) | |
| `plugins/gate-access/` | `index.js`, `GateAccessCard.jsx`, `GateKeysAlert.jsx`, `SettingsGateAccessSection.jsx`, `SasGateAccessStep.jsx`, `__tests__/` | C (moved) | |
| `components/sas/` | `SasKeypadCode.jsx` | C | The keypad code, large and dictable (generic within the SAS; exported by the SDK) |
| `hooks/` | `useDayMarkers.js` | C | Loads the plugins' day markers; `markersFor`, `legend`, `captions` |
| `App.jsx` | | T | Routes of modules, lazily loaded behind the phase 0 guard |
| `pages/` | `Dashboard.jsx`, `ReservationPage.jsx`, `CalendarPage.jsx`, `PropertyPricingSeasonsPage.jsx`, `SeasonsClosuresPage.jsx`, `EmailTemplatesPage.jsx`, `settings/IntegrationsSettingsPage.jsx`, `PluginsPage.jsx` | T | Slots instead of the phase 0 gates of the five |
| `components/` | `CalendarDayCell.jsx`, `CalendarWeekView.jsx`, `sas/ReservationSasDialog.jsx`, `SettingsCompanySection.jsx`, `PluginCard.jsx` | T | Markers; plugin steps and the portal step; portal code under `sas`; erasure and failed state |
| `constants/` | `plugins.js`, `roles.js`, `settingsMenu.js` | T | Routes, roles and menu entries of modules merged in |
| `hooks/`, `utils/` | `useSettingsForm.js`, `calendarVisuals.js` | T | `weather` group and `ZONE_COLORS` re-export removed |
| `api.js` | | T | `getPluginSettings`, `savePluginSettings`, `uninstallPlugin(id, { purge })` |

**Component reuse declaration:** `Slot` and `useDayMarkers` are generic. `SasKeypadCode` is shared by
the SAS and the gate plugin. The erasure confirmation stays inside `PluginCard`, its only user.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/plugins` | each plugin gains `hasModule`, `erasable` and `data: [{ label, count }]` (installed erasable plugins only); `state` may be `'failed'` |
| DELETE | `/api/plugins/:id?purge=1` | erases the data (rule 12) then uninstalls; 409 `NOT_ERASABLE` for a plugin without module; the phase 0 refusals apply (rule 23); 500 `PLUGIN_PURGE_FAILED` rolls back |
| POST | `/api/plugins/:id/install` | runs the plugin's migrations then its install hooks; 500 `PLUGIN_MIGRATION_FAILED` |
| GET | `/api/plugins/:id/settings` | `{ <key>: value, <secretKey>Set: bool }` for the declared keys; 404 `NO_SETTINGS`. Admin only |
| PUT | `/api/plugins/:id/settings` | `{ <key>: value }`; 400 `UNKNOWN_SETTING`; `''` on a secret keeps it, `null` clears it |
| GET | `/api/reservations/:id/sas` | `gateAccess` replaced by `pluginData: { <pluginId>: {…} }`, live plugins only (rule 17) |
| GET/PUT | `/api/settings` | the `weather` group disappears |
| GET | `/api/google-calendar/oauth/callback` | redirects to `/settings/integrations?google=<result>` (rule 19) |
| — | every other plugin URL | **unchanged** (rule 5) |

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT,                          -- encrypted blob when the key is declared secret
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, key)
);
```

**Migration `plugin_settings_from_app_settings_v1`** (ledger, runs once): copies
`meteoFranceApiKeyEncrypted` → (`weather-alerts`, `apiKey`), and `googleCalendarId`,
`googleOAuthRefreshTokenEncrypted`, `googleOAuthConnectedEmail`, `googleOAuthConnectedAt`,
`googleCalendarSummary`, `googleLastSyncAt`, `googleLastSyncOk`, `googleLastSyncDetail` →
`google-calendar` keys of the same meaning. Encrypted blobs are copied byte for byte. Empty values are not
copied.

**Tables that move from the core baseline to plugin migrations** (created on install; untouched on
existing databases):
- `weather_vigilance_cache`;
- `school_holidays` and `school_holidays_sync_state`, with the `externalRef` index;
- `tariff_recipe_runs`;
- `gate_key_results` and `gate_connector_state`.

**Data impact:** no row changes on an existing database, apart from the settings copy. Old
`app_settings` columns stay (unread) for one release, so rolling back to v3.5 finds its data intact.

## 6. UI / UX

The only visible change is the uninstall confirmation of the five moved plugins (rules 21–22). It is shown
interactively in the summary page. Copy:

- Checkbox « Effacer aussi ses données », unticked.
- Unticked note (unchanged): « Tes données sont conservées : en le réinstallant, tu retrouves tout. »
- Ticked note: « Seront effacés : <lines> . C'est définitif. »
- Buttons: « Désinstaller » → second click « Confirmer la désinstallation » (unticked) or « Désinstaller et
  effacer » (ticked, `error` colour).
- Failed plugin: `StatusBadge` « Erreur » (error) and the line « Ce plugin n'a pas pu démarrer. »

The other visible changes are fixes. Rule 17 shows the portal step without Sowel when a keypad code is
filled. Rule 19 brings the Google message back. Rule 27 makes the next school-holiday sync import every
period on its right days: on Solio the calendar dots of the synced periods move one day later (Saturday,
not Friday), and 2027-2028 appears.

**Responsive:** the checkbox and the note stack under the card's actions on `xs`; the confirm button is
full width (44 px). Nothing else moves.

## 7. Test plan

### Server — `server/src/tests/plugins-phase-1-sdk.unit.test.js` (28 tests)
- **Modules and isolation (rules 1-4, 11):** the five listed; the import walk on the real tree and on
  planted violations; a module that throws is failed, 404, the others mounted, `state: 'failed'`.
- **Routes (rule 5):** every moved URL answers 404 `PLUGIN_INACTIVE` while off; a route under a core
  prefix leaves the core routes beside it alone; mounts refused outside `/api/` and `/public/`;
  reception entries joined.
- **Tables (rules 6, 25, 26):** no table and none in `schema.sql` before install; install creates them
  and records the ledger; no-op and once on an existing database; a failed migration refuses the
  install and records nothing.
- **Settings (rules 7, 25):** secret encrypted and masked; `''` keeps, `null` clears; unknown key 400;
  the copy migration byte for byte and once.
- **Jobs (rule 8):** today's intervals and boot delays; skipped while inactive; a throw is logged.
- **Events (rule 9):** the former call sites emit the right event and nothing else calls Google; live
  plugins only; a throwing handler isolated; Google subscribed to the five events.
- **Email variables (rule 10):** filled while active, empty and false otherwise; the four paths.
- **Erasure (rules 12, 20, 22-24):** `data` lines; purge drops tables, settings and ledger rows and a
  reinstall starts empty; `NOT_ERASABLE`; refusals apply; recipes keep every season and price; a failed
  purge rolls back.
- **Rules 17-18:** `pluginData` only for live plugins, no gate field in the SAS payload; connector keys
  from the plugin only.

### Server — other new tests
- `plugins/google-calendar/tests/settings.unit.test.js` (4) — the Google connection in `plugin_settings`
  (moved from `settings-model-encryption`, which now tests the SMTP secret).
- `plugins/school-holidays/tests/school-holidays-sync-dates.unit.test.js` (5) — rule 27.
- Rule 19 is cited on the moved OAuth flow tests (`google-oauth-flow`), whose redirect assertions changed.

### Moved tests
The tests of the five plugins moved with their code into `server/src/plugins/<id>/tests/` and
`client/src/plugins/<id>/__tests__/`, with their imports updated and their assertions unchanged. There
are three exceptions:
- the OAuth redirect (rule 19);
- the gate email test, which builds its context through the plugin (rule 10);
- the Intégrations test, where the weather key is now saved through the plugin settings (rule 7).

The phase 0 source-string assertions on `index.js` and `scheduledTasks.js` now cover the seven plugins
still in the core. Server: 4,611 tests after, of which 37 are new. Client: 1,416 before, 1,434 after.

### Client (Vitest) — 18 new tests
- `plugins/sdk/__tests__/registry.test.jsx` (7) — the module list; the isolation walk (rules 3, 16);
  slot filtering and order; `<Slot>` lazy and gated; contributed routes and roles (rule 15); the
  recipes menu entry.
- `components/__tests__/PluginCard.erasure.test.jsx` (4) — rules 4, 21, 22.
- `components/sas/__tests__/ReservationSasDialog.plugins.test.jsx` (5) — the portal step without Sowel,
  with a Sowel key, and absent (rule 17); the weather step gated and shown (rule 13).
- `components/__tests__/SettingsCompanySection.portal-code.test.jsx` (2) — rule 17.

### E2E
- `plugins/plugins-page.spec.js`: + Météo uninstalled with erasure, then reinstalled → the key is gone.
  Météo rather than school holidays: a reinstall of the latter syncs from education.gouv over the
  network, and other specs open its page in parallel.
- `seed-e2e.js` creates the modules' tables; the E2E encryption key is now valid base64 of 32 bytes (it
  never was — no spec stored a secret before).
- The full suite runs unchanged: 90 passed, 1 skipped (pre-existing).

### Manual verification (done 2026-09-28, shadow on port 4101)
- **Upgrade path:** a fresh copy of the dev database at v3.5 (no phase 0), secrets purged, a test
  Météo key set. At boot: the 12 plugins installed, the key copied to `plugin_settings` still
  encrypted, the four plugin migrations recorded on the existing tables.
- **Screens:**
  - Intégrations shows Google, Neat, Météo (key « Modifier ») and Sowel in the former order, at 375 px;
  - Vacances & fermetures: the tabs are right, and « Recettes tarifaires » sits after « Options & ressources »;
  - the Gîte calendar shows the zone dots from Saturday 17 October to Sunday 1 November;
  - the arrival SAS « Portail » step shows the keypad code, with no Sowel key for the stay;
  - dashboard, reservation, pricing seasons, emails and planning load without a failed call.
- **Erasure:** school holidays uninstalled with « Effacer aussi ses données »:
  - the confirmation lists « 16 périodes de vacances · l'état de synchronisation »;
  - the route answers 404 and the tables are dropped;
  - the reinstall synced 12 official periods on their Paris days.
- **Rule 19:** `/settings?google=connected` lands on Établissement without the message (the bug), and
  `/settings/integrations?google=connected` shows « Compte Google connecté ✓ ».
- **Not checked by hand:** a real Google push. The shadow has no OAuth client; the event
  wiring is covered by the unit tests.

## 8. Out of scope

- **The seven other plugins:** SAS, linen, hourly resources, website booking, Neat, Qonto and
  accounting export move in phases 2 and 3.
- **Downloads:** the registry, packages, signatures and version ranges come in phase 4, when plugin
  modules become separate bundles.
- **Dropping the old `app_settings` columns:** in a later release, once rollback to v3.5 no longer
  matters.
- **Connector keys:** rotating the Sowel connector keys on erasure.
- **Plugin HTTP wrappers:** the client `api.js` methods of the five plugins move with their bundles in
  phase 4.
- **Solio's leftover « Été 2027 » period:** a hand-typed seed row that an earlier sync could not
  adopt; the operator deletes it from the Vacances tab (rule 27).
- **Sandboxing:** plugins run in-process with full database access (study §8.2 point 5).

## 9. Open questions

None at this stage. P1–P4 were decided by the owner on 2026-09-28 (§1).
