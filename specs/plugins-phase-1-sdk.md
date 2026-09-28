# Plugins — phase 1: the plugin SDK, and five plugins moved out of the core

| Field | Value |
|---|---|
| **Status** | Draft |
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
   `constants/plugins.js` for the 12 plugins; it gains a `module: true` flag for the five that have a
   module.
3. **Isolation.** A plugin file imports only these:
   - files of its own folder;
   - the SDK (`server/src/plugins/sdk/` on the server, `client/src/plugins/sdk/` on the client);
   - npm packages;
   - on the client, the shared UI kit: `components/` for generic components and `api` for the HTTP
     client, both exposed through the client SDK.

   The core never imports a file under `plugins/<id>/`. The only exception is the plugin list itself
   (rule 2). A test walks the imports and fails on any other import.
4. **A plugin that fails to register** (it throws in `register`) is logged with its id and reported
   `state: 'failed'` on the Plugins page, with the message « Ce plugin n'a pas pu démarrer. ». The
   server boots anyway, and the plugin's routes answer 404 `PLUGIN_INACTIVE`.

### 3.B What `register(ctx)` offers — server extension points

5. **Routes** — `ctx.mount(path, router, options)`:
   - The core mounts the router behind `requirePlugin(id)`, the session guard and the role guard.
   - The paths stay **the current ones**, because some are external contracts: `/public/v1/gate` is
     read by Sowel, and `/api/google-calendar/oauth/callback` is registered in the Google console.
   - `options.public: true` mounts the router outside the `/api` guards. Only paths under `/public/`
     are accepted. `gate-access` is the only user of this option.
   - `options.reception: [{ method, path }]` adds allowlist entries for the reception role.
     `enforceRoleAccess` reads these entries next to its own list.
   - A route of the plugin that sits inside a core router today moves to the plugin's own router, at
     **the same URL**. This applies to `weather-alerts` (`/api/reservations/:id/weather-alerts`),
     `tariff-recipes` (`/api/properties/:id/tariff-recipe/*`) and `gate-access`
     (`/api/reservations/:id/gate-access` and `/api/dashboard/gate-keys`).
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
     draft keeps the stored value, and `null` clears it, as in the rest of the settings.
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
     | `reservation.created` | `{ reservationId }` | reservation create, devis conversion |
     | `reservation.updated` | `{ reservationId }` | reservation update, iCal date-drift approval, payment link turning a devis into a stay |
     | `reservation.cancelled` | `{ reservationId }` | cancellation, iCal cancellation approval |
     | `reservation.deleted` | `{ reservationId }` | reservation delete |
     | `ical.imported` | `{ created, updated, removed }` | iCal import that changed at least one booking |

   - A handler runs only while its plugin is active. It runs asynchronously, after the response, and
     never delays or fails the write that emitted it. Its errors are caught and logged per plugin.
   - Neat's own direct calls (`kickPass`) stay as they are: Neat moves in phase 3. The bus is built so
     that Neat can subscribe to the same events then.
10. **Email variables** — `ctx.emailContext({ tokens, build(reservationId) })`:
    - `tokens` lists the variables the plugin adds, with a label for each, e.g. `gateAccessCode`,
      `gateAccessUrl`, `hasGateAccess`.
    - The email context builder merges `build()` from **active** plugins only. An inactive plugin's
      variables render empty, and its `{{#if}}` blocks read false.
    - The four email paths (preview, auto-send, guest sequence, manual send) all go through the builder,
      so they no longer call gate code.
11. **Core services** — `ctx.core` is a frozen object holding what the five plugins read from the core:
    - reading a reservation with its details;
    - the company address;
    - the public URL;
    - property pricing rules and closures (for recipes);
    - admin user ids and push sending (for gate alerts);
    - the text formatters.

    `ctx.db` is the database handle, used by the plugin's own models. `ctx.log` prefixes
    `[plugin:<id>]`. What `ctx.core` exposes is listed in the SDK file and nowhere else.
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
    | `settings.menu` | settings menu | tariff-recipes (Recettes tarifaires) |
    | `settings.integrations` | Intégrations page sections | google-calendar, weather-alerts, gate-access |
    | `dashboard.alerts` | Dashboard alert stack | gate-access (keys), tariff-recipes (runs) |
    | `reservation.cards` | reservation page, after the finance section | gate-access |
    | `sas.arrival.steps` | SAS dialog step list | weather-alerts (before the recap), gate-access (inside the portal step, rule 17) |
    | `calendar.dayMarkers` | month view, week view, property pricing calendar, legend | school-holidays |
    | `closures.tabs` | Vacances & fermetures | school-holidays |
    | `property.tariff` | property tariff tab and pricing seasons page | tariff-recipes (card, banner, extra-guest column, season badge) |
    | `emailTemplates.tokens` | token picker of the email templates page | gate-access |

14. A contribution is a lazily loaded React component (`React.lazy`). A plugin's code is only downloaded
    by the browser when one of its slots renders. The order inside a slot is declared by the
    contribution's `order`.
15. The phase 0 route guard (`ROUTE_PLUGINS`, `pluginRoute`, the redirect of a hidden URL) now reads the
    routes contributed by modules. Hand-written entries remain only for the seven plugins without a
    module.
16. The client SDK (`client/src/plugins/sdk/`) re-exports what a plugin may use: `api` (the HTTP
    client), `useAuth`, `usePlugin`, the generic components (`PageActionBar`, `StatusBadge`,
    `EmptyState`, `ConfirmDialog`, `FormDialog`, `HelpedTextField`, `MaskedTextField`…) and the theme.

### 3.D Behaviour changes that come with the move

17. **The portal code belongs to the SAS, not to Sowel.**
    - The keypad code of the property (`portalCode`, Établissement) is a SAS fact. The SAS spec owns it.
    - Its field in Établissement is shown when **`sas`** is active, instead of `gate-access` in phase 0.
    - The SAS « Portail » step shows when the keypad code is filled **or** `gate-access` has a key for
      the stay. The Sowel QR code and link are the gate-access contribution inside that step.
    - A customer without Sowel who types a keypad code now sees it in the arrival SAS. In phase 0 it was
      hidden.
18. **The gate connector secrets are created when the plugin is installed**, and at boot only if it is
    installed. A new customer who never installs `gate-access` has no connector keys. The keys stay in
    `server/.env.local`, where Sowel's configuration was copied from. Erasing the plugin's data does not
    rotate them.
19. **The Google connection message.** After the Google consent screen, the callback redirects to
    `/settings/integrations?google=<result>`, the page that shows the message. Today it redirects to
    `/settings?google=…`, whose redirect to Établissement drops the query string. The mapping flagged
    this as likely lost; I will confirm it in the browser before fixing it.
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

21. In the detail of an installed plugin that has a module (the five), the uninstall confirmation adds a
    checkbox **« Effacer aussi ses données »**, unticked by default.
    - **Unticked:** the phase 0 note stays: « Tes données sont conservées : en le réinstallant, tu
      retrouves tout. »
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
    - The 11 hard-coded school-holiday periods (2024–2026) are dropped. Installing `school-holidays`
      runs a sync at once, which fetches 24 months from education.gouv.
    - If that first sync fails (offline), the tab shows the existing sync banner with its error, and
      manual entry works.

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
| `plugins/sdk/` | `createContext.js` | C | Builds a plugin's `ctx`: mount, migrations, settings, jobs, events, emailContext, data, core, log |
| `plugins/sdk/` | `eventBus.js` | C | `emit(name, payload)` after commit; dispatches to handlers of active plugins, async and isolated |
| `plugins/sdk/` | `coreServices.js` | C | The frozen `ctx.core` facade (rule 11): the only place that lists what plugins may read |
| `plugins/sdk/` | `pluginMigrations.js` | C | Runs a plugin's migrations against the `plugin:<id>:<name>` ledger |
| `plugins/` | `index.js` | C | The list of built-in plugin modules |
| `plugins/` | `loader.js` | C | At boot: register every module (catching failures), run migrations of installed ones, mount routes, start jobs |
| `plugins/weather-alerts/` | `index.js`, `controller.js`, `meteoVigilance.js`, `meteoVigilanceLabels.js`, `cacheModel.js`, `tests/` | C (moved) | The Météo-France plugin |
| `plugins/school-holidays/` | `index.js`, `routes.js`, `controller.js`, `model.js`, `sync.js`, `educationGouvClient.js`, `validation.js`, `tests/` | C (moved) | The school holidays plugin |
| `plugins/google-calendar/` | `index.js`, `routes.js`, `controller.js`, `model.js`, `sync.js`, `events.js`, `client.js`, `oauthClient.js`, `settings.js`, `tests/` | C (moved) | Google plugin; subscribes to the 5 events; `settings.js` replaces the 9 Google accessors of `settingsModel` |
| `plugins/tariff-recipes/` | `index.js`, `routes.js`, `controller.js`, `model.js`, `store.js`, `seasonPlan.js`, `recipes/*.json`, `tests/` | C (moved) | Recipes plugin; the tariff change journal model stays core and is reached through `ctx.core` |
| `plugins/gate-access/` | `index.js`, `routes.js`, `publicRoutes.js`, `controller.js`, `keysModel.js`, `keys.js`, `results.js`, `window.js`, `invitationView.js`, `requireConnector.js`, `signResponse.js`, `tests/` | C (moved) | Sowel plugin; email variables; SAS contribution; dashboard endpoint |
| `models/` | `pluginsModel.js` | T | + `failed` state in memory; `purge(id)` orchestration |
| `models/` | `pluginSettingsModel.js` | C | `plugin_settings` read/write, encrypt secrets |
| `models/` | `settingsModel.js` | T | Google accessors and Météo column removed from `COLUMNS` / `ENCRYPTED_COLUMNS` / masks |
| `controllers/` | `pluginsController.js` | T | `failed` state; `DELETE ?purge=1`; `describe` lines in the payload; migrations on install; settings endpoints |
| `controllers/` | `reservationsController.js`, `reservationCancellationController.js`, `dashboardController.js`, `devisController.js` | T | Direct Google calls replaced by `events.emit` |
| `controllers/` | `sasController.js` | T | Drops `gateAccess` from the payload; the portal step decision reads `portalCode` + the gate contribution (rule 17) |
| `controllers/` | `settingsController.js` | T | `weather` group removed (moved to the plugin settings endpoint) |
| `controllers/` | `emailsController.js` | T | No gate import; the builder merges plugin variables |
| `utils/` | `emailContextBuilder.js` | T | Merges `emailContext` providers of active plugins; the `gateInvitation` argument disappears |
| `utils/` | `emailAutoSendRunner.js`, `guestEmailSequenceRunner.js`, `reservationEmailSender.js` | T | No gate import |
| `utils/` | `paymentPollRunner.js` | T | `events.emit('reservation.updated')` instead of the injected Google push |
| `utils/` | `pluginsSchema.js` | T | + `plugin_settings` table; the settings copy migration |
| `models/` | `propertyIcalModel.js` | T | `events.emit('ical.imported')` instead of `scheduleReconcile` |
| `middleware/` | `enforceRoleAccess.js` | T | Reads reception entries contributed by plugins (rule 5) |
| `routes/` | `reservations.js`, `properties.js`, `dashboard.js`, `settings.js` | T | Plugin routes removed (now in the plugins, same URLs) |
| `routes/` | `plugins.js` | T | `GET/PUT /:id/settings` |
| `scheduledTasks.js` | | T | The 4 plugin jobs removed (registered by their plugins) |
| `index.js` | | T | Loader call after the core routers; plugin mounts; gate secrets no longer created unconditionally |
| `database.js`, `schema.sql`, `utils/dbHygiene.js` | | T | Tables of the five plugins and the 11-period seed removed from the core baseline |
| `package.json` | | T | Test glob adds `src/plugins/**/tests/*.test.js` |

No new npm dependency. `googleapis` and `qrcode` stay in `server/package.json`.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `index.js` | C | What a plugin may import (rule 16) |
| `plugins/sdk/` | `Slot.jsx` | C | Renders the lazily loaded contributions of active plugins for a slot name, ordered |
| `plugins/sdk/` | `useSlot.js` | C | Contributions of a slot for the current user (used where a slot needs data, not markup, e.g. routes, tokens) |
| `plugins/` | `index.js` | C | The list of client plugin modules |
| `plugins/weather-alerts/` | `index.js`, `SettingsSection.jsx`, `SasStep.jsx`, `__tests__/` | C (moved) | |
| `plugins/school-holidays/` | `index.js`, `SchoolHolidaysPage.jsx`, 5 components, `DayMarkers.jsx`, `zoneColors.js`, `schoolYear.js`, `__tests__/` | C (moved) | `frenchHolidays.js` `getSchoolHolidayInfo` moves here |
| `plugins/google-calendar/` | `index.js`, `SettingsSection.jsx`, `__tests__/` | C (moved) | |
| `plugins/tariff-recipes/` | `index.js`, `TariffRecipesPage.jsx`, `RecipeCard.jsx`, `RunsAlert.jsx`, `ChangeJournal.jsx`, `TariffBanner.jsx`, `__tests__/` | C (moved) | |
| `plugins/gate-access/` | `index.js`, `GateAccessCard.jsx`, `GateKeysAlert.jsx`, `SettingsSection.jsx`, `SasPortalGate.jsx`, `__tests__/` | C (moved) | |
| `App.jsx` | | T | `<Routes>` include contributed routes |
| `pages/` | `Dashboard.jsx`, `ReservationPage.jsx`, `CalendarPage.jsx`, `PropertyPricingSeasonsPage.jsx`, `SeasonsClosuresPage.jsx`, `EmailTemplatesPage.jsx`, `settings/IntegrationsSettingsPage.jsx`, `PluginsPage.jsx` | T | `PluginGate`/imports of the five replaced by `<Slot>` |
| `components/` | `CalendarDayCell.jsx`, `CalendarWeekView.jsx`, `property/PropertyTariffTab.jsx`, `sas/ReservationSasDialog.jsx`, `SettingsCompanySection.jsx`, `PluginCard.jsx` | T | Slots; portal code under `sas` (rule 17); erasure checkbox (rule 21) |
| `utils/` | `calendarVisuals.js` | T | No longer re-exports `ZONE_COLORS` |
| `constants/` | `plugins.js`, `settingsMenu.js` | T | Route and menu entries of the five come from the modules |
| `hooks/` | `useSettingsForm.js` | T | `weather` group removed |
| `api.js` | | T | `getPluginSettings`, `savePluginSettings`, `uninstallPlugin(id, { purge })` |

**Component reuse declaration:** `Slot` is generic, as is every slot it renders. The erasure
confirmation stays inside `PluginCard`, which is its only user. No component is specific to a plugin
outside the plugin folders.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/plugins` | each plugin gains `hasModule: bool`, `erasable: bool` and `data: [{ label, count }]` (the `describe()` lines, only for installed erasable plugins); `state` may be `'failed'` |
| DELETE | `/api/plugins/:id?purge=1` | erases the data (rule 12) then uninstalls. `purge` on a plugin that is not erasable → 409 `NOT_ERASABLE` |
| POST | `/api/plugins/:id/install` | runs the plugin's migrations first; 500 `PLUGIN_MIGRATION_FAILED` |
| GET | `/api/plugins/:id/settings` | `{ <key>: value, <secretKey>Set: bool }` for declared keys. Admin only |
| PUT | `/api/plugins/:id/settings` | `{ <key>: value }`; unknown key → 400 `UNKNOWN_SETTING`; `''` on a secret keeps it, `null` clears it |
| GET/PUT | `/api/settings` | the `weather` group disappears (now `/api/plugins/weather-alerts/settings`); `googleConnected` etc. were already not in it |
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
filled. Rule 19 brings the Google message back.

**Responsive:** the checkbox and the note stack under the card's actions on `xs`; the confirm button is
full width (44 px). Nothing else moves.

## 7. Test plan

### Server — `server/src/tests/plugins-phase-1-sdk.unit.test.js` (≈ 30 tests)
- **Loader:**
  - registers the five modules;
  - a module that throws → `failed` state, other plugins mounted, 404 on its route;
  - the core boots.
- **Isolation:** the import walk passes on the real tree and fails on a planted core→plugin and
  plugin→core import.
- **Migrations:**
  - run only for an installed plugin;
  - ledger names `plugin:<id>:<name>`;
  - idempotent on existing tables;
  - failure at install → 500, stays available, no ledger row.
- **Settings:**
  - declare/get/set;
  - secret encrypted at rest and masked over HTTP;
  - `''` keeps and `null` clears;
  - unknown key → 400;
  - the copy migration moves the 9 values byte for byte and runs once.
- **Jobs:** registered with today's intervals; skipped while inactive; an error is logged and does not
  stop the scheduler.
- **Events:**
  - each of the 10 former call sites emits the right event;
  - a handler of an inactive plugin is not called;
  - a throwing handler does not fail the write.
- **Email variables:**
  - gate variables present when active;
  - empty, with `{{#if hasGateAccess}}` false, when inactive, across the 4 email paths.
- **Erasure:**
  - `describe()` lines per plugin;
  - `purge` drops tables, settings and ledger rows;
  - reinstall recreates empty tables;
  - recipes erasure keeps every season, price and closure, and clears only attachment and `seasonKey`;
  - `purge` on a non-erasable plugin → 409;
  - rollback on failure.
- **Gate structural closures:**
  - `/api/dashboard/gate-keys` answers 404 when inactive;
  - the SAS payload has no gate field;
  - no connector secret is created on a database without the plugin.
- **Rule 17:** the portal step is available with a keypad code and no gate plugin.
- **Rule 19:** the OAuth callback redirects to `/settings/integrations?google=`.

### Moved tests
The existing tests of the five plugins move with their code into `server/src/plugins/<id>/tests/` and
`client/src/plugins/<id>/__tests__/`, their imports are updated, and their assertions stay unchanged.
The phase 0 source-string assertions on `index.js` and `scheduledTasks.js` are rewritten against the
loader. Count before and after: same number of test cases, plus the new ones.

### Client (Vitest) — ≈ 14 new tests
- `Slot`:
  - renders active contributions in order;
  - renders nothing for an inactive plugin;
  - is lazy (no import before render).
- Contributed routes join the route guard.
- `PluginCard`:
  - erasure checkbox only when `erasable`;
  - ticked → server lines, « C'est définitif. », red « Désinstaller et effacer »;
  - calls `uninstallPlugin(id, { purge: true })`.
- `failed` badge.
- SAS portal step with a keypad code and no gate plugin.
- Établissement portal code gated on `sas`.

### E2E
- `plugins/plugins-page.spec.js`: + install `school-holidays`, uninstall **with erasure**, reinstall →
  empty tab with the sync banner. The seed keeps the 12 plugins active.
- The whole existing suite runs unchanged. It is the non-regression proof that nothing visible moved.

### Manual verification
- **Shadow on a copy of Solio:** Google still connected; weather key still set; holidays, recipes and
  gate unchanged; a reservation create or update still pushes to Google.
- **Erasure:** of each of the five on the shadow, then reinstall.
- **Fresh database:** no plugin table until install.
- **Mobile:** the erasure confirmation at 375 px.

## 8. Out of scope

- **The seven other plugins:** SAS, linen, hourly resources, website booking, Neat, Qonto and
  accounting export move in phases 2 and 3.
- **Downloads:** the registry, packages, signatures and version ranges come in phase 4, when plugin
  modules become separate bundles.
- **Dropping the old `app_settings` columns:** in a later release, once rollback to v3.5 no longer
  matters.
- **Connector keys:** rotating the Sowel connector keys on erasure.
- **Sandboxing:** plugins run in-process with full database access (study §8.2 point 5).

## 9. Open questions

None at this stage. P1–P4 were decided by the owner on 2026-09-28 (§1).
