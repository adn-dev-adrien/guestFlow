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
   - `online-payment` while a payment link is still `open` → « 1 lien de paiement en attente : à payer
     ou annuler d'abord. » (plural: « N liens de paiement en attente : … »); and, since 2026-10-04,
     while a link cancelled here is still payable at the provider (`remoteCancelPendingAt`) → « 1 lien
     retiré ou expiré encore actif chez le prestataire : désactivation en cours, réessayer plus tard. »
     (code `LINKS_PENDING_DEACTIVATION`; reworded 2026-10-30 by specs/payment-link-lifecycle.md rule 23:
     a lapsed link owed its deactivation blocks too, and GuestFlow deactivates it by itself)
   - `sas` while an active user holds the reception role without admin → « 1 compte Accueil actif :
     changer son rôle dans Utilisateurs d'abord. » (plural: « N comptes Accueil actifs : changer leur
     rôle … »)
   - `accounting-export` while an active user holds the accountant role without admin → same wording
     with « Comptable ».
   The server is authoritative; the page shows the same message under the card before the click, and
   « Désactiver » and « Désinstaller » are disabled while it holds (fixed 2026-10-04: the message used
   to appear only after the refused click).
9. Only an admin reaches the Plugins page and its API. Every role receives the list of active plugins
   (rule 14).

### 3.C Existing databases and new customers

10. **Existing database** (at least one property or one reservation when the migration runs): the 12
    plugins are installed **and active**. Solio sees no difference after the update.
    > **2026-10-18 (merge of `master` v3.10.0):** « the 12 » are the twelve former core features
    > (`SEEDED_ON_EXISTING_IDS` in `constants/plugins.js`), not the whole catalogue: since #683 the seed
    > also installed « Saisie Gîtes de France » active, against its spec (« not installed by default »),
    > and would have done the same for « Saisie Booking ». A plugin added after phase 0 is never seeded.
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
    | `gate-access` | Intégrations › Accès portail; gate keys alert; gate card of the reservation page; the connected-gate variant of the SAS portal step |
    | `neat` | Intégrations › Neat; Neat chip, retry and void on the insurance option row |
    | `online-payment` | Paramètres › Paiements en ligne; « Envoyer la demande de paiement » and « … de solde » buttons |
    | `google-calendar` | Intégrations › Google Agenda |
    | `accounting-export` | Suivi financier › Comptabilité and › Plateformes comptables; « Comptable » in the role picker |
    | `sas` | the SAS buttons of the planning cards and the `?sas=` deep links; the « Facturables au SAS » tab; lost items card; « Accueil » in the role picker; the reception home; the « Code portail » field of Établissement |
    | `tariff-recipes` | Paramètres › Recettes tarifaires; recipe runs alert; recipe card and recipe column of the property tariff |
    | `school-holidays` | « Vacances scolaires » tab (the entry stays for Fermetures); zone bands and A/B/C legend of the calendar |
    | `weather-alerts` | Intégrations › Météo; weather step of the SAS |

    > _2026-10-27 (spec review): the « Code portail » field of Établissement belongs to `sas`
    > (`client/src/plugins/sas/SettingsPortalCodeField.jsx`, slot `settings.etablissement`), not to
    > `gate-access`: the code is what the arrival SAS hands the guest, connected gate or not. With
    > `gate-access` off the SAS still shows its portal step with the typed code (`SasKeypadCode`);
    > only the connected-gate variant (`sas.portal` slot) goes._

17. A settings entry that only holds plugin sections disappears when none of them is active:
    **Intégrations** (Google, Neat, Météo, Portail) — empty → hidden.
18. The client never calls the API of an inactive plugin (no 404 noise in the console).
19. A URL typed by hand to a hidden page (e.g. `/parametres/recettes`) lands on the home page, as a role
    refusal does today — or on « Mon compte » for a role without a home page (accountant).
    > **Sans test** — the redirect lives in the app shell (`App.jsx`), which no Vitest suite mounts, and
    > an E2E check needs every plugin of a page off, which would break the specs running beside it in
    > the parallel local run. The predicate it uses (`isRouteEnabled`) is covered by
    > `roles.plugins.test.js`; the redirect itself was checked by hand on the 8 plugin pages (§7).
    > _2026-10-18: an administrator is no longer sent home — the address stays and reads « Plugin
    > inactif » with « Ouvrir Plugins » (specs/plugins-phase-p-productisation.md rule 42). Every
    > other role keeps this rule._
20. Existing per-hour resources stay listed in the options catalogue when `hourly-resources` is inactive:
    their price type reads « Par heure (plugin inactif) » and is only offered in the form of a resource
    that already has it. A per-hour resource already on a stay stays listed there with its price, without
    the sessions picker; its past sessions stay on the stays (rule 7).
    > **Superseded** (2026-10-18) — by `specs/plugins-phase-3c-hourly-resources.md` rules 18–20: a
    > `per_hour` resource is hidden while `hourly-resources` is off, and comes back with its slots, prices
    > and sessions when it is reactivated. « Par heure (plugin inactif) » is no longer offered anywhere.
    > **Sans test** — replaced; the behaviour that ships is covered by the phase 3c rules 18–20 tests.

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
25. **A card tells the real state and offers the useful action** (UI/UX review 2026-10-18, proposal
    19; amends rule 22 for active plugins). The server computes, per plugin, `setup: { needed, label,
    path, action }`:
    - the plugin says what it still lacks through `ctx.setupStatus(() => null | '<what>')` (SDK
      1.5.0, specs/plugins-phase-1-sdk.md §3.B) — a cheap, synchronous look at its own settings:
      Google Agenda « à connecter » then « agenda à choisir », Neat « identifiants manquants »,
      Paiement en ligne « à connecter », Vigilance Météo-France « clé manquante »; a check that
      throws counts as nothing missing;
    - the core holds where each plugin is set up (`PLUGIN_SETTINGS_PLACES`, next to `PLUGIN_PAGES`):
      its own page (Linge, Paiements en ligne, Recettes, Vacances & fermetures, Options & ressources
      for the hourly resources, Plan comptable for the export) or its tab of Intégrations,
      `/settings/integrations?tab=<id>` (the anchor `#plugin-<id>` until 2026-10-22, still read —
      specs/integrations-tab-per-plugin.md rule 6); `null` for a plugin with nothing to set up (SAS).

    An active plugin that lacks something reads **« Actif · à connecter »** (warning badge) and its
    main button is **« Configurer »** (contained); set up, it reads « Actif » and offers
    **« Réglages »** (outlined) when it has a place; with none, no button. Both open the place in the
    app. **« Désactiver » moves into a ⋯ menu** and asks first: « Désactiver Google Agenda ? — Ce
    qu'il ajoute s'arrête. Ses réglages et ses données sont gardés : le réactiver remet tout en
    place. » [Désactiver] [Garder]. A refusal of rule 8 disables that menu item and says why under
    it (it is no longer printed in the card). Above the installed list, a chip **« À configurer
    (n) »** (n = `toConfigure` of `GET /api/plugins/status`) keeps only those cards; it is not shown
    when n = 0. Inactive and available plugins keep « Activer » / « Installer » (rule 22).

26. **« Configurer » lands on its plugin, and stays there while the page loads** (integrated review of
    inte/plugins, 2026-10-19, M1). The anchor `#plugin-<id>` (rule 25) is placed as soon as it exists,
    and put back in place at every layout change until the page settles (rule 27) — the Intégrations sections load lazily and
    grow as their own requests answer, which pushed it down after the first scroll — until the user
    scrolls, touches, clicks or types: from then on the page is theirs. Its `scroll-margin-top` is the
    measured bottom of the sticky bars (the app bar and the PageActionBar) plus 8 px, never a guessed
    constant. Generic hook: `hooks/useAnchorScroll.js`. E2E: after « Configurer » on Neat and on
    Vigilance Météo-France the anchor is in the viewport, below the bars, at 390 and 1280 px.

    > **Sans test** — replaced on 2026-10-22: Intégrations has one tab per plugin and « Configurer »
    > opens the tab (specs/integrations-tab-per-plugin.md rules 5, 6 and 9, tested there); there is no
    > anchor to hold in place any more, and `hooks/useAnchorScroll.js` is removed.
27. **The anchor lets go when the page has settled, and never breaks the page** (review of PR #728, M4
    and B2). The re-placing of rule 26 stops 800 ms after the LAST layout change (a slow section keeps
    it going), at 8 s at the latest, and at once on a wheel, a touch, a click, a key, or a scroll with
    no layout change behind it (the scrollbar dragged; a scroll that follows a change of the page's
    height is the browser's and places the anchor again). Everything before the anchor is left out of
    the browser's scroll anchoring (`overflow-anchor: none`) until the user takes over, so a section
    above that grows after the timers have stopped does not push it away. The same « Configurer »
    clicked twice (same hash, new navigation)
    runs it again. A hash that does not decode (« #plugin-%E0%A4%A ») is looked up as typed instead
    of throwing into the error screen.

    > **Sans test** — replaced on 2026-10-22 with rule 26: Intégrations has one tab per plugin and « Configurer »
    > opens the tab (specs/integrations-tab-per-plugin.md rules 5, 6 and 9, tested there); there is no
    > anchor to hold in place any more, and `hooks/useAnchorScroll.js` is removed.

**Edge cases:**
- (rule 25) A plugin out of the plan never counts as « à configurer ».
- (rule 25) A plugin packaged for SDK < 1.5.0 declares no check: it reads « Actif » with « Réglages ».
- Two admins toggle at the same time → the last write wins; each page reloads the list after its action.
- A session open when an admin deactivates a plugin → its menu updates at its next `/me` (page load or
  navigation refresh); its API calls to the plugin get 404 and it shows the generic error.
- Deactivating `sas` while a SAS dialog is open elsewhere → the commit gets 404; nothing is half-written
  (the commit is one transaction today).
- Reservation with Neat insurance when `neat` is inactive → the option line and its price stay; the Neat
  chip and actions disappear.

---

### Review fixes (2026-10-04)

- Rule 8: the refusal is shown before the click and disables the buttons it refuses (above); a link
  cancelled but still payable at the provider blocks `online-payment` too.
- Rule 12 edge case: an erasure that fails leaves the plugin installed **and inactive**, as this spec
  always said; the controller now sets it so (it used to stay active).
- Every message of the Plugins page is impersonal and short (owner's rule, 2026-10-05).
- Tests: `plugins-phase-0.unit.test.js` (messages), `PluginCard.erasure.test.jsx` (+1: the refusal before the click), `plugins-phase-1-sdk.unit.test.js` (a failed erasure leaves the plugin inactive).

### 3.F The bare install (added 2026-10-22)

The approved plan ran the E2E suite a second time with every plugin off; §7 dropped it (parallel local
run, doubled CI time) and left the « nothing active » configuration to Vitest and a manual walk. These
rules bring it back as its own focused run, and record what that run found.

28. **A bare install is tested end to end, on every PR.** A second E2E configuration starts a new
    customer with no plugin installed (rule 11), past the start assistant, on its own database
    (`playwright.bare.config.js`, `npm run test:e2e:bare`, specs in `e2e/bare/`, CI job « bare install
    (no plugin) » of `e2e.yml`). It proves that: no core page names a plugin's subject, links to a
    plugin page or to Intégrations, or calls a plugin's API (rule 18); a plugin page typed by hand says
    which plugin it needs (phase P rule 42); the Plugins page has nothing installed and offers every
    plugin; the core runs a stay — property, client, reservation priced by the server, quote saved and
    its PDF downloaded, the stay on the planning, the property's iCal export, finance and emails pages.
    The seed (`E2E_SEED_PLUGINS=none`) creates no « Accueil » account, as a new customer has none.
29. **A role a plugin brings cannot be given without it** (found by rule 28). `POST /api/users` and
    `PUT /api/users/:id` answer `400 { error: 'ROLE_PLUGIN_INACTIVE', field: 'roles', role, plugin }`
    when a role the account does not already hold belongs to a plugin that is not live: « Accueil »
    (`reception`) ← `sas`, « Comptable » (`accountant`) ← `accounting-export` (`ROLE_PLUGINS` in
    `constants/plugins.js`). The client already hid them (rule 16); the server is now the authority.
    A role already held is kept: rule 8 keeps its plugin from being switched off under it.
30. **An empty planning names no plugin's cards** (found by rule 28). It read « Aucune arrivée ni
    créneau ressource… », which speaks of `hourly-resources` on an instance without it; it now reads
    « Rien de prévu sur les 14 prochains jours. » whatever the plugins.
31. **The old « Tarifs » address opens a tab that exists** (found by rule 28). `/parametres/tarifs`
    redirects to `/parametres/options-ressources?tab=sas` only while the `sas` plugin is active (its
    « Montants facturés » tab lives there); without it, to `/parametres/options-ressources` with no
    tab, so the address never names a tab the page does not have.

32. **Every active card has its button, and its text never cut** (2026-10-27 audit). The `sas` plugin's
    settings place is its « Facturables au SAS » tab (`/parametres/options-ressources?tab=sas`), so
    its card offers « Réglages » like the others instead of looking empty. On every card the version
    flows on the name's line (it dropped onto its own line when the name and the button filled the
    row) and the status badge wraps (« Actif · identifiant partenaire manquant » was cut).

## 4. Architecture

> Fat backend, thin frontend: the server owns the catalogue, the states, the refusal rules and the list
> of active plugins. The client only hides what the server says is inactive.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `plugins.js` | C | The 12-plugin catalogue (rule 2) and the id constants; `PLUGIN_SETTINGS_PLACES` (rule 25) |
| `controllers/` | `pluginsController.js` | T | Rule 25: `setup` in each view, `toConfigure` in the status, `views()` for the core's readers |
| `plugins/` | `sdk/createContext.js`, `sdk/registry.js`, `sdk/version.js` | T | Rule 25: `ctx.setupStatus(fn)`; SDK 1.5.0 |
| `plugins/` | `google-calendar`, `neat`, `online-payment`, `weather-alerts` (`index.js`, `manifest.json`) | T | Rule 25: each declares its check; 1.1.0, `sdk ^1.5.0` and `guestflow >=3.10.0`, a French changelog line |
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
| `pages/` | `PluginsPage.jsx` | C | The page (rules 21–24); rule 25: « À configurer (n) » filter, navigation to a card's settings place, back arrow to the Paramètres summary |
| `components/` | `PluginCard.jsx` | T | Rule 25: the server's state label, « Configurer » / « Réglages », « Désactiver » in ⋯ with a confirmation |
| `pages/` | `settings/IntegrationsSettingsPage.jsx` | T | Rule 25: each plugin's first section carries `#plugin-<id>`, scrolled to below the sticky bars once it has loaded |
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
| GET | `/api/plugins` | — | `[{ id, name, description, icon, category, surfaces: [string], state: 'available'\|'active'\|'inactive', blocker: null \| { code, message }, setup: { needed, label, path, action } }]` | `blocker` = why deactivate/uninstall would be refused now; `setup` (rule 25) |
| GET | `/api/plugins/status` | — | `{ …, toConfigure }` | Rule 25: active plugins that lack something |
| POST | `/api/plugins/:id/install` | — | the plugin | 409 `ALREADY_INSTALLED` |
| POST | `/api/plugins/:id/activate` | — | the plugin | 409 `NOT_INSTALLED` |
| POST | `/api/plugins/:id/deactivate` | — | the plugin | 409 `{ error: 'PLUGIN_BLOCKED', code, message }` (rule 8) |
| DELETE | `/api/plugins/:id` | — | the plugin (`state: 'available'`) | same 409 as deactivate |
| GET | `/api/auth/me` | — | user + `enabledPlugins: [id]` | also on `POST /api/auth/login` |
| any | a route of an inactive plugin | — | 404 `{ error: 'PLUGIN_INACTIVE', plugin }` | |

Unknown id → 404 `UNKNOWN_PLUGIN`.

**Integrated review of inte/plugins (2026-10-19)** — rule 26:
- Client `hooks/useAnchorScroll.js` (new, generic; removed on 2026-10-22 by specs/integrations-tab-per-plugin.md): places the element a hash names below the measured
  sticky bars and keeps it there while the page settles; stops at the first user scroll (rule 27:
  `quietMs`, `maxMs`, `navigationKey`, `anchorIdOf` for a malformed hash).
- Client `pages/settings/IntegrationsSettingsPage.jsx`: uses it for `#plugin-<id>` (the fixed
  `scroll-margin-top` is gone). `components/PageActionBar.jsx` marks itself `data-sticky-bar`.

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
  second click « Confirmer la désinstallation ». Uninstall note: « Données conservées. » (2026-10-04:
  every text is impersonal and short — no « tu », no « vous »).
- Status: `StatusBadge` « Actif » (success) / « Inactif » (neutral).
- Refusals: rule 8 wording, in red under the card.
- `PageActionBar title="Plugins"` without Save/Cancel: each action is immediate.
- Rule 25 (2026-10-19): the validated rendering is mock 7 of the UI/UX review
  (`docs/rapports/2026-10-18-ui-ux-review.html#settings-m7`). Badge « Actif · à connecter » (warning),
  « Configurer » / « Réglages », ⋯ (44 × 44, bordered) holding « Désactiver… », chip « À configurer
  (n) » beside the search. On `xs` the action row spans the card: « Configurer » grows, ⋯ at the end.
  « Configurer » opens the page in the app (no inline setup form: the settings stay where they live).

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

### Rule 25 (2026-10-19)
- Server `plugins-setup-state.unit.test.js` (10): every plugin has a settings place; « Actif · à
  connecter » + « Configurer » then « Réglages »; inactive / no place; a throwing check; the
  `toConfigure` count; `ctx.setupStatus` takes a function (SDK 1.5.0); the checks of Google Agenda,
  Neat, Météo-France and Paiement en ligne.
- Client `PluginCard.setup.test.jsx` (4), `PluginsPage.to-configure.test.jsx` (2); updated
  `PluginCard.erasure` (the refusal in the ⋯ menu) and `PluginsPage` (deactivate through ⋯ and its
  confirmation).
- E2E `plugins-page.spec.js` deactivates through ⋯ and the confirmation.

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

### E2E — bare install, `e2e/bare/bare-install.spec.js` (5 tests, added 2026-10-22, rules 28–30)
- Its own configuration (`playwright.bare.config.js`, database `/tmp/guestflow-e2e-bare.db`), seeded
  with `E2E_SEED_PLUGINS=none`; one CI job beside the smoke suite. This restores the second run of the
  approved plan without the two problems above: it runs in its own process and database, and only the
  focused bare specs run, not the whole suite twice.
- Server `plugin-role-refusal.unit.test.js` (5 tests, rule 29).

### Manual verification (done 2026-09-28)
- New customer (fresh DB, no plugin): 23 core pages visited — no request answered `PLUGIN_INACTIVE`, no
  page error; the menu shows only core entries plus « Plugins »; the 8 plugin pages typed by hand land
  on the home page without mounting (so without any call); Options & ressources has 2 tabs, Vacances &
  fermetures shows the closures without tabs.
- Plugins page: installing Linge adds « Linge » to the menu without a reload; SAS deactivation refused.
- Mobile 375 px: Plugins page without horizontal scroll, detail and two-click uninstall in place.

**Integrated review of inte/plugins (2026-10-19)** — rule 26: `hooks/__tests__/useAnchorScroll.settle.test.jsx` (waits for the anchor, measured
margin, put back on a layout change, stops 800 ms after the last change and at 8 s, stops on a user
scroll or a scrollbar drag, re-places after a browser scroll that follows a layout change, runs
again for a new navigation of the same hash, malformed hash, scroll anchoring left out — rule 27; 10);
E2E `e2e/specs/plugins/plugins-page.spec.js` (« Configurer » on Neat and Vigilance
Météo-France: the anchor is in the viewport below the bars, at 390 and 1280 px).

- **2026-10-27 audit (rule 32):** `PluginCard.layout.test.jsx` (2 tests); the SAS case of
  `plugins-setup-state.unit.test.js` now expects « Réglages ».

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
