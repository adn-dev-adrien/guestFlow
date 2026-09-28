# Plugins — phase 0: the Plugins page and hiding what is not installed

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugins-phase-0` _(created once the spec is approved)_ |
| **Created** | 2026-09-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — decisions D1–D6, phasing §12 |
| **Summary for review** | [`docs/specs/2026-09-28-plugins-phase-0-foundation.html`](../docs/specs/2026-09-28-plugins-phase-0-foundation.html) |

---

## 1. Context

GuestFlow shows every feature to every install. The owner arbitrated on 2026-09-28 which features are
optional (D6, `plugins-inventory.md` §5.3): **12 plugins**, everything else core. Nothing in the code
knows about plugins today — no table, no flag, no client context; the only visibility mechanism is the
role map (`ROUTE_ROLES` + `canSeeRoute`, `client/src/constants/roles.js:46-103`).

Phase 0 is the first step of the phasing (§12 of the study): **no code moves** into packages yet. The 12
features stay where they are in the repository; this phase gives each one an on/off switch, a Plugins
page to drive it, and makes every entry point of a switched-off plugin disappear — menus, routes,
settings sections, dashboard alerts, buttons on the reservation page, SAS steps, planning cards — and
stops its server routes and background jobs.

The plugins become downloadable packages in phase 4. Until then they are **built-in**: always shipped,
installed or not per database.

## 2. Goal

An admin opens **Paramètres › Plugins**, sees which features are installed and which are available,
installs, activates, deactivates or uninstalls them, and the rest of GuestFlow immediately shows only
what is installed and active. A new customer starts with none; Solio keeps all twelve.

## 3. Functional rules

### 3.A The catalogue

1. The 12 built-in plugins, their ids and what they carry:

   | id | Name (FR) | Carries |
   |---|---|---|
   | `hourly-resources` | Ressources à l'heure | sessions of per-hour resources (nordic bath), resource planning |
   | `linen` | Linge et blanchisserie | linen stock, laundry rounds, beds to prepare |
   | `website-booking` | Réservation depuis le site | `/public/v1` (except gate), booking requests, online CGV acceptance |
   | `gate-access` | Accès au portail (Sowel) | gate keys, `/public/v1/gate`, portal code |
   | `neat` | Assurance annulation Neat | Neat subscription, badge and actions |
   | `online-payment` | Paiement en ligne (Qonto) | Qonto connection, payment links, polling, webhook |
   | `google-calendar` | Google Agenda | push and reconcile to a Google calendar |
   | `accounting-export` | Export comptable | accounting entries, account plan, platform accounting page, accountant role |
   | `sas` | Arrivée et départ guidés | SAS dialog, « Facturables au SAS », lost items, departure checklist, reception role |
   | `tariff-recipes` | Recettes tarifaires | recipes, horizon job, recipe card |
   | `school-holidays` | Vacances scolaires | education.gouv sync, calendar zone bands, holidays tab |
   | `weather-alerts` | Vigilance Météo-France | vigilance alerts, SAS weather step |

2. The catalogue is a server constant: id, French name, one-line description, icon key, category,
   the list of surfaces it adds (shown on the Plugins page) and `requires` (empty for all 12 in phase 0;
   the field exists for phase 4).
3. A plugin has three states per database: **available** (not installed), **installed and active**,
   **installed and inactive**.

### 3.B Install, activate, deactivate, uninstall

4. **Install** an available plugin → it becomes installed **and active** in one click.
5. **Deactivate** keeps every piece of its data and its settings (Q1). **Activate** brings it back as it was.
6. **Uninstall** is behind a two-click confirmation. In phase 0 it **keeps the data** too: the plugin
   returns to « Disponibles » and a reinstall finds everything back. The dialog says so. The choice to
   erase data (Q1) arrives with phase 1, when plugins own their tables.
7. **Money never moves.** Toggling a plugin never changes a price, a payment, a balance or an accounting
   entry. Price lines already on a stay (e.g. nordic bath sessions, Neat premium) keep being shown and
   counted on the reservation page, the quote PDF and the finance pages; only the tools that *create or
   edit* them disappear.
8. **Refusals** — deactivating or uninstalling is refused, with the reason and the way out, when it would
   leave something live without its tool:
   - `online-payment` while a payment link is still `open` → « 1 lien de paiement est en attente. Attends
     son paiement ou annule-le avant de désactiver. » (plural: « N liens … Attends leur paiement ou
     annule-les … »)
   - `sas` while an active user holds the reception role without admin → « 1 compte Accueil est actif.
     Change son rôle dans Utilisateurs d'abord. » (plural: « N comptes Accueil sont actifs. Change leur
     rôle … »)
   - `accounting-export` while an active user holds the accountant role without admin → same wording
     with « Comptable ».
   The server is authoritative; the page shows the same message before the click (status `blocked`).
9. Only an admin reaches the Plugins page and its API. Every role receives the list of active plugins
   (rule 14).

### 3.C Existing databases and new customers

10. **Existing database** (at least one property or one reservation when the migration runs): the 12
    plugins are installed **and active**. Solio sees no difference after the update.
11. **New database**: no plugin is installed. The customer sees the core only and installs what they need.
12. The seed is a named migration (`plugins_builtin_seed_v1`) recorded in the `migrations` ledger, so it
    runs once; a later wipe of the `plugins` table is not re-seeded.

### 3.D What disappears when a plugin is not active

13. "Not active" means available **or** installed-and-inactive; both hide the same things.
14. The list of active plugin ids travels with the user: `GET /api/auth/me` and `POST /api/auth/login`
    return `enabledPlugins`. The Plugins page refreshes it after each change, so the menu updates
    without a reload.
15. **Server** — for an inactive plugin:
    - its API routes answer **404** `{ "error": "PLUGIN_INACTIVE", "plugin": "<id>" }`;
    - its public routes (`/public/v1/*` for `website-booking`, `/public/v1/gate` for `gate-access`, the
      public pay and status routes of a site devis for `online-payment`) answer 404 the same way — the
      WordPress site then shows its "unavailable" state;
    - the cancellation compensations share the `/api/accounting` prefix but are **core** (D6): only the
      export routes (`sales`, `sales.csv`, `platforms`, `platform-accounts`) belong to
      `accounting-export`. The dashboard alert settles a compensation without the accounting page;
    - its scheduled jobs skip their tick;
    - the direct calls from core code into it return immediately: the Google push, delete and
      reconcile (one guard in the sync's `isActive`), the Neat kick from the payment flows (one guard
      in its `runPass`).
16. **Client** — for an inactive plugin nothing points to it:

    | Plugin | Hidden |
    |---|---|
    | `hourly-resources` | Calendrier › Ressources; « à l'heure » price type of resources (rule 20); a per-hour resource not already on the stay, and the sessions picker, on the reservation page; resource cards of the planning; the scheduling step of the SAS |
    | `linen` | Paramètres › Linge; linen shortage alert; laundry button, cards and dialogs of the planning; the linen, linen-items and bath-linen steps of the SAS |
    | `website-booking` | « Demandes du site » alert; « Site internet » badge and filter of the quotes; CGV acceptance line of the reservation page |
    | `gate-access` | Intégrations › Accès portail; portal code field of Établissement; gate keys alert; gate card of the reservation page; portal step of the SAS |
    | `neat` | Intégrations › Neat; Neat chip, retry and void on the insurance option row |
    | `online-payment` | Paramètres › Paiements en ligne; « Envoyer la demande de paiement » and « … de solde » buttons |
    | `google-calendar` | Intégrations › Google Agenda |
    | `accounting-export` | Suivi financier › Comptabilité and › Plateformes comptables; « Comptable » in the role picker |
    | `sas` | the SAS buttons of the planning cards and the `?sas=` deep links; the « Facturables au SAS » tab; lost items card; « Accueil » in the role picker; the reception home |
    | `tariff-recipes` | Paramètres › Recettes tarifaires; recipe runs alert; recipe card and recipe column of the property tariff |
    | `school-holidays` | « Vacances scolaires » tab (the entry stays for Fermetures); zone bands and A/B/C legend of the calendar |
    | `weather-alerts` | Intégrations › Météo; weather step of the SAS |

17. A settings entry that only holds plugin sections disappears when none of them is active:
    **Intégrations** (Google, Neat, Météo, Portail) — empty → hidden.
18. The client never calls the API of an inactive plugin (no 404 noise in the console).
19. A URL typed by hand to a hidden page (e.g. `/parametres/recettes`) lands on the home page, as a role
    refusal does today — or on « Mon compte » for a role without a home page (accountant).
    > **Sans test** — the redirect lives in the app shell (`App.jsx`), which no Vitest suite mounts, and
    > an E2E check needs every plugin of a page off, which would break the specs running beside it in
    > the parallel local run. The predicate it uses (`isRouteEnabled`) is covered by
    > `roles.plugins.test.js`; the redirect itself was checked by hand on the 8 plugin pages (§7).
20. Existing per-hour resources stay listed in the options catalogue when `hourly-resources` is inactive:
    their price type reads « Par heure (plugin inactif) » and is only offered in the form of a resource
    that already has it. A per-hour resource already on a stay stays listed there with its price, without
    the sessions picker; its past sessions stay on the stays (rule 7).

### 3.E The Plugins page

21. Entry **Paramètres › Plugins**, last of the settings menu, admin only.
22. Two tabs, « Installés (n) » and « Disponibles (n) » — the `PageTabs` of the action bar, like every
    other tabbed page — a search field, one card per plugin: icon, name, one-line
    description, status (Actif / Inactif), the action (Activer / Désactiver on installed, Installer on
    available). A click on the card opens its detail: what it adds, and « Désinstaller » behind a
    two-click confirmation.
23. A refusal (rule 8) shows under the card, in red, with the way out.
24. Empty states: « Aucun plugin installé. Tout ce qui est facultatif est dans Disponibles. » and « Tous
    les plugins sont installés. »

**Edge cases:**
- Two admins toggle at the same time → the last write wins; each page reloads the list after its action.
- A session open when an admin deactivates a plugin → its menu updates at its next `/me` (page load or
  navigation refresh); its API calls to the plugin get 404 and it shows the generic error.
- Deactivating `sas` while a SAS dialog is open elsewhere → the commit gets 404; nothing is half-written
  (the commit is one transaction today).
- Reservation with Neat insurance when `neat` is inactive → the option line and its price stay; the Neat
  chip and actions disappear.

---

## 4. Architecture

> Fat backend, thin frontend: the server owns the catalogue, the states, the refusal rules and the list
> of active plugins. The client only hides what the server says is inactive.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `plugins.js` | C | The 12-plugin catalogue (rule 2) and the id constants |
| `models/` | `pluginsModel.js` | C | Reads/writes the `plugins` table; `isActive(id)`, `listActiveIds()` read the table each time (no cache: a write by another process, e.g. the E2E seed, is seen at once); blocker counts |
| `controllers/` | `pluginsController.js` | C | List with states and blockers; install / activate / deactivate / uninstall; refusal rules (rule 8) |
| `routes/` | `plugins.js` | C | `GET /api/plugins`, `POST /:id/install`, `POST /:id/activate`, `POST /:id/deactivate`, `DELETE /:id` |
| `middleware/` | `requirePlugin.js` | C | `requirePlugin(id)` → 404 `PLUGIN_INACTIVE` (rule 15) |
| `index.js` | `index.js` | T | Mounts `/api/plugins`; wraps the plugin mounts: `/api/resource-bookings`, `/api/laundry`, `/api/neat`, `/api/payments` (webhook included), `/api/google-calendar`, `/api/tariff-recipes`, `/api/school-holidays`, `/public/v1`, `/public/v1/gate` |
| `routes/` | `accounting.js` | T | `requirePlugin` on the export routes only; the cancellation compensations stay core (rule 15) |
| `routes/` | `reservations.js`, `settings.js`, `planning.js`, `properties.js`, `resources.js`, `public/bookingRequests.js` | T | Per-route `requirePlugin` on the plugin endpoints inside core routers (SAS, lost items, gate access, weather alerts, gate connector, laundry, linen inventory, resource cards, tariff recipe, free slots, public pay/status). The linen-items and repair-amounts settings stay readable: they are plain settings |
| `controllers/` | `authController.js` | T | `me` and `login` add `enabledPlugins` |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Each plugin pass (payment poll, Google sync, Neat, tariff horizon, school holidays sync, gate stale read) is wrapped in `whenPluginActive`, checked at every tick |
| `utils/` | `pluginScheduling.js` | C | `whenPluginActive(id, pass)` |
| `utils/` | `pluginsSchema.js` | C | `plugins` table DDL + `plugins_builtin_seed_v1` (rules 10–12), testable on an in-memory DB |
| `utils/` | `googleCalendarSync.js` | T | `pluginActive` factory dep (default on; the production instance wires the plugin state) checked in `isActive` |
| `controllers/` | `neatController.js` | T | Same `pluginActive` dep, checked in `runPass` (covers the kicks) |
| `database.js` | `database.js` | T | Calls `ensurePluginsTable` + `seedBuiltinPlugins` |
| `scripts/` | `seed-e2e.js` | T | Installs the 12 plugins active for the Playwright suite (its DB starts empty = a new customer) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `plugins.js` | C | Plugin id constants; `ROUTE_PLUGINS` (path → plugin id) |
| `constants/` | `roles.js` | T | `canSeeRoute` also checks `ROUTE_PLUGINS` against `user.enabledPlugins` — every sidebar item and route guard inherits it |
| `constants/` | `settingsMenu.js` | T | New « Plugins » entry; `visibleSettingsMenu(isVisible)` drops hidden entries and the dividers left without a family (Intégrations uses `ROUTE_PLUGINS` any-of) |
| `hooks/` | `usePlugins.js` | C | `usePlugin(id)` → boolean, from `useAuth().user.enabledPlugins` |
| `components/` | `PluginGate.jsx` | C | Renders its children only when the plugin is active |
| `components/` | `PluginCard.jsx` | C | One plugin card (status, action, detail, two-click uninstall, refusal) |
| `pages/` | `PluginsPage.jsx` | C | The page (rules 21–24) |
| `pages/` | `Dashboard.jsx`, `ReservationPage.jsx` (Neat block passed as null to the form context), `DevisPage.jsx`, `PlanningPage.jsx` (plugin fetches skipped), `CalendarPage.jsx` (holidays fetch and legend), `OptionsResourcesPage.jsx`, `ResourcesPage.jsx`, `SeasonsClosuresPage.jsx`, `PropertyPricingSeasonsPage.jsx`, `settings/IntegrationsSettingsPage.jsx` | T | Wrap each surface of rule 16 in `PluginGate` or `usePlugin` |
| `components/` | `sas/ReservationSasDialog.jsx`, `reservation/ExtrasSection.jsx`, `property/PropertyTariffTab.jsx`, `SettingsCompanySection.jsx`, `AccountFormDialog.jsx`, `PricedItemsPage.jsx` (`retired` price types) | T | Same, for the embedded surfaces (SAS steps; per-hour resources and sessions picker; recipe column; portal code; role options; « Par heure ») |
| `App.jsx` | `App.jsx` | T | Route `/parametres/plugins`; the settings submenu through `visibleSettingsMenu`; a route guard sends a hidden plugin page home (rule 19); hand-written sub-items use `can()` which now includes the plugin check |
| `api.js` | `api.js` | T | `getPlugins`, `installPlugin`, `activatePlugin`, `deactivatePlugin`, `uninstallPlugin` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `PageTabs`, `StatusBadge`, `EmptyState`, `ErrorAlert`, `LoadingState` | |
| **Created (new generic)** | `PluginGate` | Used by ~25 surfaces across 12 files, and by every future plugin slot |
| **Specific (kept feature-local)** | `PluginCard` | Only the Plugins page lists plugins |

### 4.3 API contract

All under the admin guard except `/me` and `/login`.

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/plugins` | — | `[{ id, name, description, icon, category, surfaces: [string], state: 'available'\|'active'\|'inactive', blocker: null \| { code, message } }]` | `blocker` = why deactivate/uninstall would be refused now |
| POST | `/api/plugins/:id/install` | — | the plugin | 409 `ALREADY_INSTALLED` |
| POST | `/api/plugins/:id/activate` | — | the plugin | 409 `NOT_INSTALLED` |
| POST | `/api/plugins/:id/deactivate` | — | the plugin | 409 `{ error: 'PLUGIN_BLOCKED', code, message }` (rule 8) |
| DELETE | `/api/plugins/:id` | — | the plugin (`state: 'available'`) | same 409 as deactivate |
| GET | `/api/auth/me` | — | user + `enabledPlugins: [id]` | also on `POST /api/auth/login` |
| any | a route of an inactive plugin | — | 404 `{ error: 'PLUGIN_INACTIVE', plugin }` | |

Unknown id → 404 `UNKNOWN_PLUGIN`.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id           TEXT PRIMARY KEY,               -- catalogue id
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)), -- active = 1, inactive = 0
  source       TEXT NOT NULL DEFAULT 'builtin',-- 'builtin' now; 'registry' in phase 4
  version      TEXT,                           -- null for built-ins
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No row = available. Columns match Sowel's `plugins` table minus `manifest` and `pinned_sha256`, which
arrive with downloads in phase 4.

Migration `plugins_builtin_seed_v1`: if `properties` or `reservations` has a row, insert the 12 ids with
`enabled = 1`; record the ledger entry either way.

**Data impact:** none on existing rows. No feature column is touched; deactivation and uninstall delete
nothing in phase 0.

## 6. UI / UX

The interactive mock-up is in the summary page. Copy:

- Menu entry and page title: « Plugins ». Tabs « Installés » / « Disponibles ». Search placeholder
  « Chercher un plugin… ».
- Card actions: « Activer », « Désactiver », « Installer ». Detail: « Ce qu'il ajoute », « Désinstaller »,
  second click « Confirmer la désinstallation ». Uninstall note: « Tes données sont conservées : en le
  réinstallant, tu retrouves tout. »
- Status: `StatusBadge` « Actif » (success) / « Inactif » (neutral).
- Refusals: rule 8 wording, in red under the card.
- `PageActionBar title="Plugins"` without Save/Cancel: each action is immediate.

**Responsive:** `xs` — one card per row, action button full width under the name (44 px), detail expands
in place, the tabs fold onto the second row of the action bar; `md`+ — two-column grid of cards. No
dialog: the uninstall confirmation is inline.

## 7. Test plan

### Server unit tests — `server/src/tests/plugins-phase-0.unit.test.js` (27 tests)
- Catalogue: 12 unique ids, every field present.
- Seed migration: existing DB (property, or reservation only) → 12 active; fresh DB → none; the ledger
  prevents a second seed after everything was uninstalled.
- Model: transitions; a write from another connection is seen at once (no cache).
- Controller: list with states; install → active; 409 `ALREADY_INSTALLED` / `NOT_INSTALLED`; 404
  `UNKNOWN_PLUGIN`; deactivate / activate / uninstall; uninstall leaves every other table untouched;
  the API is admin-only (accountant and reception get 403 from the existing role guard).
- Refusals: open payment link blocks `online-payment` (exact singular wording); active reception-only
  users block `sas` (plural wording), an admin+reception or inactive user does not; accountant-only user
  blocks `accounting-export`; the blocker shows in the list before the click, only on installed plugins.
- `requirePlugin`: 404 `PLUGIN_INACTIVE` / `next()`; over real HTTP (`app.listen(0)` + fetch) a mounted
  router disappears and comes back; the mounts and per-route guards are wired (`index.js`, accounting
  export routes but not the compensations, SAS, resource cards, public pay).
- Jobs: `whenPluginActive` skips then resumes; every plugin pass of the scheduler is wrapped; the Google
  sync reads inactive; the Neat pass (and so its kicks) is skipped.
- `login` / `me` carry `enabledPlugins`, never frozen into the session.
- Money never moves: the pricing engine does not read plugin states (rule 7 — phase 0 touches no price
  code, so the invariant is that no plugin check ever enters it).

### Client tests (Vitest) — 22 new tests
- `constants/__tests__/roles.plugins.test.js` (10): plugin routes hidden without their plugin for admin
  and accountant; Intégrations any-of; Plugins page admin-only; fail closed without the list;
  `visibleSettingsMenu` drops entries and orphan dividers.
- `components/__tests__/PluginGate.test.jsx` (3): children, nothing (never mounted), fallback.
- `pages/__tests__/PluginsPage.test.jsx` (7): default tab, install from « Disponibles », deactivate +
  auth refresh, refusal under the card, two-click uninstall, search + empty state, empty tab.
- `components/reservation/__tests__/ExtrasSection.hourly-plugin-inactive.test.jsx` (2): without the
  plugin a per-hour resource is not offered, one already sold stays listed without the sessions picker.
- The 31 existing suites that render a gated component mock `usePlugin` to « every plugin active » —
  the Solio configuration they describe; `roles.test.js` gives its users the full list.

### E2E — `e2e/specs/plugins/plugins-page.spec.js` (5 tests)
- `seed-e2e.js` installs the 12 plugins active, so every existing spec keeps the Solio configuration.
- The spec: 12 installed on the seeded DB; deactivating Google Agenda removes its Intégrations section
  and its API answers 404 `PLUGIN_INACTIVE`, activating brings both back; two-click uninstall → «
  Disponibles » → install back active; SAS deactivation refused by the seeded reception account; the
  Plugins entry in the submenu.
- **Changed from the approved plan:** the suite is not run a second time with every plugin off. The
  suite runs in parallel locally, so a spec switching every plugin off would break the specs running
  beside it, and running everything twice doubles the CI time. The « nothing active » configuration is
  covered by the Vitest route/menu tests and by the manual walk below.

### Manual verification (done 2026-09-28)
- New customer (fresh DB, no plugin): 23 core pages visited — no request answered `PLUGIN_INACTIVE`, no
  page error; the menu shows only core entries plus « Plugins »; the 8 plugin pages typed by hand land
  on the home page without mounting (so without any call); Options & ressources has 2 tabs, Vacances &
  fermetures shows the closures without tabs.
- Plugins page: installing Linge adds « Linge » to the menu without a reload; SAS deactivation refused.
- Mobile 375 px: Plugins page without horizontal scroll, detail and two-click uninstall in place.

## 8. Out of scope

- Moving plugin code into packages, the plugin SDK, slots, lifecycle events (phase 1).
- Erasing data on uninstall (phase 1, Q1).
- Downloading plugins, registry, versions (phase 4).
- Hiding Solio-specific content (productisation stream).
- Per-plugin settings storage: settings stay in `app_settings` until phase 1.

## 9. Open questions

- Q: In phase 0, should uninstall exist at all, since it keeps the data like deactivate?
  - A (2026-09-28): **yes**. The page has its final shape from the start, and « Disponibles » is where a
    new customer shops. Uninstall keeps the data until phase 1 adds the erase choice (rule 6).
