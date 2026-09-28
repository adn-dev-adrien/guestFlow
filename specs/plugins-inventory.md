# Plugins and commercial hosting — inventory before making GuestFlow sellable

- **Status:** Study — decisions D1–D7 and both open questions settled on 2026-09-28; nothing here is implemented
- **Date:** 2026-09-28
- **Base:** `master` at v3.3.1
- **Summary for decision:** `docs/specs/2026-09-28-plugins-inventory.html`
- **Workstreams and core/plugin arbitration:** `docs/specs/2026-09-28-commercialisation-workstreams.html` (§14)

---

## 1. Why this study

GuestFlow was built for one business, Domaine Solio. The goal is to sell it to other gîte owners.
Three things stand in the way:

1. **Every feature is always on.** An owner with one gîte, no nordic bath, no laundry round and no
   breakfast still sees the resource planning, the linen stock, the breakfast steps of the arrival
   dialog, the Neat settings, and so on. The UI is sized for Solio.
2. **Solio's own content is baked in.** Email copy, catering price list, tariff recipes, accounting
   accounts and a few URLs ship with every install.
3. **There is no way to host customers.** One install is one business on a hand-built VM, updated from
   a public AGPL repository.

The target model is **plugins**: optional features that add capabilities to GuestFlow. When a plugin
is not installed, **no UI tied to it appears anywhere** — menu, settings, dashboard, reservation page,
arrival/departure dialog, planning. Plugins are managed from a dedicated page, as in Sowel.

## 2. Decisions taken (2026-09-28)

| # | Question | Decision |
|---|---|---|
| D1 | Plugin distribution | **Downloadable, as in Sowel**: a registry, one package per plugin, SHA-256 pinned, installed from the Plugins page. |
| D2 | Tourist tax | **Stays in the core.** Not a plugin. |
| D3 | Hosting | **One GuestFlow process per customer**, behind a control plane owned by the publisher (§9). |
| D4 | Licence | **Proprietary licence and private repository** from the next version on; the WordPress plugin stays GPLv2+ in its own public repository (§10). |
| D5 | Solio's own instance | **Solio becomes customer #1** of the hosted platform, migrated from its current VM when the platform is ready. |
| D6 | Core vs plugins | **12 plugins, everything else core** — see §5.3. Overrides the 18-candidate table of §5.2 where they differ. |
| D7 | Target market | **France only**: admin UI in French, EUR only (§7). |

## 3. Measurements

| Item | Value |
|---|---|
| Server code (excl. tests) | ~60 000 lines, 45 controllers, 55 models |
| Client code (excl. tests) | ~46 000 lines, 30 pages, ~140 components |
| Server test files | 466 |
| `database.js` | 2 607 lines, run at `require` time, 214 guarded `ALTER`s, ~25 named data migrations, `module.exports = db` |
| Files requiring `../database` directly | 74 (51 models) |
| Tables | ~98 (60 in `schema.sql`, ~38 added in `database.js`) |
| `app_settings` | one row (`CHECK (id = 1)`), ~60 of its columns belong to optional features |
| Pricing engine | `calculateReservationQuote`, `server/src/utils/pricing.js:1220`, ~1 440 lines, ~70 named parameters, 9 call sites |
| Arrival/departure dialog | `client/src/components/sas/ReservationSasDialog.jsx`, 1 991 lines, two `switch (stepKey)` blocks |
| Idle memory of one GuestFlow process (fresh DB, measured) | 117–133 MB RSS |
| Existing plugin / feature-flag mechanism | **none**, on either side |

## 4. How optional features are wired today

There is no registry. Features are wired in five ways, all hard-coded:

1. **Direct `require` + call** — e.g. `googleCalendarSync.schedulePush` from 7 call sites,
   `neatController.kickPass` from 4, `notificationService` from 3.
2. **Branches on catalogue flags** — `options.isCancellationInsurance`, `autoOptionType`,
   `showsPlanningCard`, `countsAsBedLinen`, `resources.priceType === 'per_hour'`, and even title
   substrings (`stayContentContext.roleOf`, `server/src/utils/stayContentContext.js:89-106`, matches
   "trappeur", "animation", "lit bebe").
3. **Feature columns on shared wide tables** — `app_settings` (qonto 23, neat 13, google 8, linen 8…),
   `reservations` (breakfast 10, SAS, extinguisher…), `options`, `resources`.
4. **Static lists** — `app.use` ×36 in `server/src/index.js:175-213`, `setInterval` ×11 in
   `server/src/scheduledTasks.js:304+`, `navItems` in `client/src/App.jsx:88-98`, `SETTINGS_MENU` in
   `client/src/constants/settingsMenu.js`, 10 alert components in `client/src/pages/Dashboard.jsx:364-391`,
   step keys in `ReservationSasDialog.jsx:552-620`.
5. **Implicit activation** — integrations count as "on" when their credentials are set (Qonto, Google,
   Neat, Météo-France); client widgets hide themselves when their endpoint returns nothing.

The client has **no config context**: `api.getSettings()` is read only by settings pages. Menu
visibility is role-based only (`ROUTE_ROLES` + `canSeeRoute`, `client/src/constants/roles.js`) — the
natural place to add plugin gating.

## 5. Proposed split: core vs plugins

### 5.1 Core (always present)

Reservations and quotes (one table, `kind = 'reservation' | 'devis'`), clients, properties, seasons and
prices, options catalogue, **per-stay** resources (e.g. baby bed), platforms (name, commission,
colour), payment schedule and manual payments, refunds, finance overview, **tourist tax (D2)**, calendar,
establishment closures, users and roles, CGV, SMTP + manual email templates, translations (EN
catalogue), public holidays, calendar notes, the Plugins page.

Platforms stay in core: commission, `isDirectChannel` and the platform-collected tax flags run through
pricing, finance and accounting. Only the iCal **sync** is a plugin.

### 5.2 Plugin candidates (18)

Difficulty: **S** easy (isolated), **M** medium (a few hooks), **L** hard (inside pricing, SAS commit or
accounting snapshots).

| # | Plugin | Server footprint | UI surfaces that must disappear | Difficulty |
|---|---|---|---|---|
| 1 | **Hourly resources** (nordic bath) | `resourceBookings*`, `resourceScheduling/Occupancy`, `resourceHourlyPricing`, thermal columns on `resources`, `resource_bookings` | Menu Calendrier › Ressources; ResourcesPage hourly fields; fiche "sessions" picker (`ExtrasSection.jsx:31-110`); SAS step `resourceScheduling`; planning ignition + session cards | **L** — pricing `:1900-2060`, SAS commit, public projections |
| 2 | **Operational planning** | `planningController` (aggregator), `planningOptionCardsModel`, `cardOccurrences` | Menu Planning; option "Afficher une carte dans le planning"; fiche occurrences grid | **M** — becomes a *host* for cards from other plugins |
| 3 | **Linen & laundry** | `laundry*`, `linen*`, `bedLinenAdequacy`, `repair_amounts`, 7 settings, 4 linen seeds | Réglages › Linge; dashboard linen shortage; "Lits à préparer" column; fiche bed inputs; SAS linen/towel steps; planning laundry cards | **M** |
| 4 | **Breakfast & catering** | `breakfastModel`, `breakfastPushRunner`, `mealPortions`, catering seeds, 10 reservation columns | Options breakfast fields; fiche "Heure souhaitée"; SAS breakfast/catering steps; planning breakfast cards; push category | **L** — `mealPortions` feeds pricing, devis, public quote |
| 5 | **Push notifications** | `push*`, `vapid`, `arrivalDeparturePushRunner`, service worker | Réglages › push section; `registerServiceWorker()` in `index.jsx:18` | **M** |
| 6 | **Automatic guest emails** (sequence + auto-send) | `emailAutoSend*`, `guestEmailSequence*`, `guest_email_sends`, `/preferences` | Dashboard pending emails; Historique › Simulation; client "Ne pas envoyer les mails après séjour" | **M** — manual templates stay core |
| 7 | **Website booking (WordPress)** | `/public/v1`, `controllers/public/*`, `publicProjections`, `requirePublicApiKey`, WP plugin in `integrations/wordpress/guestflow-booking` | Dashboard "Demandes du site"; devis "Site internet" badge and filter; CGV acceptance toggle; fiche CGV line | **M** |
| 8 | **Sowel gate access** | Today only `app_settings.portalCode`; the real feature (`/gate/v1/*`, `specs/guest-gate-access.md`) is unmerged | "Code portail" field; SAS `portal` step | **S** — build it as a plugin from day one |
| 9 | **Neat cancellation insurance** | `neat*`, `neat_subscriptions`, `neat_price_cache`, 13 settings, quote post-processor | Réglages › Intégrations › Neat; fiche Neat badge and actions; push category; public quote insurance | **L** — 11 inbound call sites |
| 10 | **Online payment (Qonto)** | `qonto*`, `payment_links`, poll runner, webhook, 23 settings | Réglages › Paiements en ligne; fiche "Envoyer la demande de paiement/solde"; public pay | **L** — needs a `paymentProvider` interface first |
| 11 | **Google Calendar** | `googleCalendar*`, 8 settings, reconcile job | Réglages › Intégrations › Google | **S** — ideal case for lifecycle events |
| 12 | **iCal sync** | `propertyIcalModel` (sync engine), 8 `ical_*` tables, 5-min job | Property tab "Plateformes & iCal"; 3 dashboard alerts | **L** — anti-overbooking contract must not regress |
| 13 | **Accounting export** | `accountingModel`, `accountingExport` (Solio CSV), `constants/accounting.js` | Menu Comptabilité, Plan comptable | **M** — accounts must become data first |
| 14 | **Guided arrival/departure (SAS)** | `sasController`, `sasOptionSale`, `receptionView`, SAS columns | SAS dialog, "Facturables au SAS" tab, lost items card, reception role | **L** — becomes a *host* for steps |
| 15 | **Tariff recipes** | `tariffRecipe*`, `recipes/*.json`, horizon job | Réglages › Recettes; dashboard recipe runs; property recipe card | **S** |
| 16 | **French school holidays** | `schoolHolidays*`, education.gouv sync | Vacances tab; calendar zone bands and A/B/C legend | **S** |
| 17 | **Météo-France alerts** | `weatherController`, `meteoVigilance`, cache | Réglages › Intégrations › Météo; SAS weather step | **S** |
| 18 | **Platform cancellation compensations** | `cancellationCompensations*` | Dashboard pending compensations; accounting section | **M** — requires iCal (12) |

Soft links (a plugin *enriches* another when both are present, never requires it): linen, breakfast and
hourly resources add cards to planning; breakfast and Neat add push categories; hourly resources,
breakfast, linen, weather and Sowel add SAS steps. Hard link: compensations → iCal.

Undecided small features: welcome pack (`properties.welcomePackCost`), lost items (goes with SAS),
the departure extinguisher check (Solio-specific — should become a configurable checklist in SAS).

**Revised recommendations (2026-09-28, pending the owner's arbitration in §14):**

- **iCal sync (12) → core.** Almost every gîte sells on at least one platform and every PMS on the
  market ships it; extracting it is an L that puts the anti-overbooking contract at risk only to hide
  one tab from the rare direct-only gîte. Compensations (18) stays a plugin that requires it.
- Welcome pack cost → core (one field, no screen). Lost items, the configurable departure checklist
  and the reception role → plugin, requiring the SAS plugin (14).
- A core feature may never require a plugin; a plugin may require another plugin.

### 5.3 The owner's split (D6, 2026-09-28)

Arbitrated line by line in the workstreams page.

**Core (27):** reservations and quotes, clients, properties, seasons and prices, options catalogue,
per-stay resources, platforms, payment schedule and manual payments, refunds, finance overview,
tourist tax, calendar, establishment closures, users and roles, CGV, email sending and manual
templates, EN translations, public holidays, calendar notes, the Plugins page, **operational
planning**, **breakfast & catering**, **push notifications**, **automatic guest emails**, **iCal
sync**, **platform cancellation compensations**, welcome pack cost.

**Plugins (12):**

| Plugin | Carries |
|---|---|
| Hourly resources (nordic bath) | sessions, thermal model, resource planning page |
| Linen & laundry | stock, laundry rounds, beds to prepare |
| Website booking (WordPress) | `/public/v1`, booking requests, online CGV acceptance |
| Sowel gate access | gate keys, `/gate/v1`, portal code |
| Neat cancellation insurance | subscription, price cache, quote post-processor |
| Online payment (Qonto) | payment links, polling, webhook |
| Google Calendar | push and reconcile |
| Accounting export | entries, account plan, CSV export, platform accounting page |
| Guided arrival/departure (SAS) | the SAS dialog, "Facturables au SAS", **lost items**, the configurable **departure checklist** (replaces the extinguisher check), the **reception role** |
| Tariff recipes | recipes, horizon job |
| French school holidays | education.gouv sync, calendar zone bands |
| Météo-France vigilance | alerts, cache |

The three small features the page listed separately (lost items, departure checklist, reception role)
are **part of the SAS plugin**, not separately installable: each only exists inside the SAS.

**Consequences of the split:**

1. **Phase 3 shrinks.** Breakfast & catering stays in the pricing engine as core; only hourly
   resources, Neat and Qonto need price-line contributors / a payment-provider interface.
2. **Planning is a core host.** Its breakfast, arrival/departure and compensation cards stay core;
   the hourly-resource and linen cards come from their plugins through the `planningCards` point.
3. **The SAS steps of core features move with the SAS.** Breakfast/catering, towels and payment
   steps live in the SAS plugin and read core data; hourly resources, linen, weather and Sowel add
   their own steps to it (plugin → plugin, soft links).
4. **Automatic guest emails are core**, so the productisation item "sequence shipped disabled with
   neutral copy" becomes a core requirement for every new customer, not a plugin default.
5. **iCal + compensations stay core**: the anti-overbooking contract is never behind a plugin switch.

## 6. Extension points the core must provide

Each plugin declares contributions; the core iterates over installed plugins instead of importing
features.

| Extension point | Replaces | Consumers |
|---|---|---|
| `routes` (server, mounted under `/api/plugins/<id>`, with declared auth exemptions) | `index.js:175-213`, hard-coded bypass list `:135-160` | all |
| `migrations` (own tables, ledger `plugin:<id>:<name>` in the existing `migrations` table) | `database.js` | all with tables |
| `settings` (per-plugin key/value, encrypted keys declared) | ~60 `app_settings` columns | 3, 5, 9, 10, 11, 17 |
| `scheduledJobs` `{name, intervalMs, run}` | `scheduledTasks.js` | 3, 4, 5, 6, 9, 10, 11, 12, 15, 16 |
| `lifecycle` events: `reservation.created/updated/paid/cancelled/deleted`, `devis.converted`, `ical.imported`, `booking.requested` | 14 direct call sites | 5, 6, 9, 11 |
| `priceLineContributors` + `quotePostProcessors` | inline blocks in `pricing.js`; Neat reprice | 1, 4, 9 |
| `optionKinds` (explicit option roles) | `isCancellationInsurance`, `autoOptionType`, `seedKey`, title matching | 3, 4, 9 |
| `accountingEntrySources` + row builders + account registry | `accountingController.js:24-26`, `accountingExport.js`, `constants/accounting.js` | 13, 18 |
| `emailContextProviders` + default templates | `emailContextBuilder`, `stayContentContext`, `defaultEmailTemplatesRegistry` | 3, 4, 6, 10 |
| `dashboardWidgets` | static list in `Dashboard.jsx` | 3, 6, 7, 12, 15, 18 |
| `sasSteps` (server data + commit, client component) | `sasController.getSas`, `commitArrivalSas`, SAS `switch` | 1, 3, 4, 8, 17 |
| `planningCards` | `planningController` imports | 1, 3, 4 |
| `ficheBlocks` / fiche sections | `reservationsController.getById:476-498`, ReservationPage | 9, 10 |
| `publicApi` extensions | `/public/v1` catalogue/quote projections | 1, 7, 9 |
| client `navEntries`, `routes`, `settingsSections`, `slots` in core pages | `App.jsx`, `settingsMenu.js`, `IntegrationsSettingsPage` | all |

## 7. Specific to Solio, but not a plugin

These must become generic whatever the plugin design, because they reach every install today.

| Item | Where | Fix direction |
|---|---|---|
| Guest email sequence copy: "Domaine Solio", address, domainesolio.com, "13 hectares", bain nordique, seeded **enabled** | `server/src/utils/guestEmailSequenceTemplates.js` (18 hits), `defaultEmailTemplatesRegistry.js:26` | neutral defaults with `{{companyName}}` tokens; Solio copy moves to a Solio content pack |
| Unsubscribe page titled "Vos nouvelles du Domaine Solio" | `controllers/public/emailPreferencesController.js:14,22` | use company name |
| 14 catering options with Solio's price list (Brasserie du Pilat, Terroir Ardèche…) | `server/src/utils/cateringSeed.js:40-139` | out of core seeds |
| Bundled tariff recipes `gite-2027.json`, `aventura-lodge-2026.json` | `server/src/recipes/` | move to Solio data dir (`GUESTFLOW_RECIPES_DIR`) |
| Accounting accounts 706/70601/4457/4671/6226xx, journal `VT`, "SOLIO" CSV layout | `server/src/constants/accounting.js`, `utils/accountingExport.js` | account plan as data; export format selectable |
| Lodgify treated as a direct channel | `server/src/utils/platformNameFormat.js:60` | platform attribute, not a constant |
| Platform list and colours in client code | `client/src/constants/platforms.js:7`, `server/src/constants/platformColors.js` | read from the `platforms` table |
| Default `websiteUrl: 'https://domainesolio.com'` | `client/src/pages/PaymentsSettingsPage.jsx:66` | empty |
| VAPID subject fallback `mailto:contact@domainesolio.com` | `server/src/utils/vapid.js:20` | company email |
| "Piscine ouverte du/au", Instagram, Google review, "Cafetière familiale", extinguisher check | `SettingsEmailContentSection.jsx:37-63`, `PropertyStayTab.jsx:35,54`, `ReservationSasDialog.jsx:1525-1536` | configurable stay facts / checklist |
| `Europe/Paris` hard-coded outside `serverTimezone` | 7 server files | one source |
| EUR only, admin UI French only, French tourist-tax model | 38 server / 24 client files for "€" | **decided 2026-09-28: French market only.** Admin UI stays French, amounts stay EUR; English remains for guests (emails, website) |
| `integrations/wordpress/solio-site/` (23 mu-plugins, LAN IPs, SSH user) in a public repo | whole folder | move out of the product repo |
| No first-run onboarding: a new customer lands on an empty app with Solio seeds | — | setup wizard (company, first property, plugins) |

## 8. Plugins: downloadable, as in Sowel (D1)

### 8.1 What Sowel does

`sowel-core/ui/src/pages/PluginsPage.tsx`, `src/packages/package-manager.ts`, `src/plugins/plugin-loader.ts`:

- **Registry** `registry.json` on GitHub (raw `main`, 1 h cache, manual refresh) with `sha256` per
  release tarball; official owners vs community (confirmation modal); personal sources with
  trust-on-first-use pinning.
- **Package** = GitHub release asset `tar.gz` containing `manifest.json`, `package.json`, pre-built
  `dist/` with no runtime dependencies. No `npm install` at install time.
- **Manifest** `id, name, version, description, icon, repo, author, sowelVersion (">=x.y.z"), settings[]`.
- **Table** `plugins(id, version, enabled, installed_at, manifest, source, pinned_sha256)`; settings in
  the core key/value store under `integration.<id>.<key>`.
- **Loader**: `createPlugin(deps)` factory, deps wrapped in scoped proxies (settings namespace, event
  allowlist), lifecycle methods wrapped so a throwing plugin degrades instead of crashing the boot.
- **Page**: pill tabs *Installed / Store*, search, one card per plugin (icon tile, status, version,
  update chip, Enable/Disable), detail sheet with **Uninstall** isolated behind a two-click
  confirmation, "Update all" banner.
- **Known gaps** (to avoid): no plugin routes, no plugin migrations, no dependency model, only `>=`
  version checks, plugin UI limited to one standalone page mounted as a DOM node (spec 180, unmerged),
  `pluginDir` wiped on update with no persistent `dataDir`, settings left behind on uninstall.

### 8.2 What GuestFlow needs on top

GuestFlow plugins reach deep into core screens (reservation page, SAS, planning, pricing), so the
Sowel model has to be extended:

1. **Server contributions** declared by `register(ctx)`: routes, migrations, jobs, lifecycle
   subscriptions, price contributors, SAS steps, planning cards, email variables (§6). `ctx` is a
   scoped SDK: tenant DB access through plugin-owned tables + read-only core views, settings namespace,
   logger, event bus.
2. **Client contributions inside core pages**, not a single standalone page. The host exposes a stable
   runtime (React, MUI, the GuestFlow component library, `api`) through an import map / global SDK;
   plugin bundles are ES modules built with those as externals and loaded with dynamic `import()`. Core
   pages render named **slots** (`reservation.options.row`, `sas.arrival.steps`, `dashboard.alerts`,
   `settings.sections`, `nav.entries`…) filled by active plugins. One React instance, so no "two
   Reacts" problem.
3. **Dependencies** between plugins (`requires`, e.g. compensations → iCal) and a **core version range**
   (`guestflow: ">=4.0.0 <5.0.0"`), both enforced at install and at core update.
4. **Data lifecycle**: disable keeps data; uninstall asks whether to purge the plugin's tables and
   settings. A persistent `dataDir` per plugin survives updates.
5. **Trust**: only the official registry at first (plugins run in-process with full access to the
   customer's data); third-party plugins later, if ever, under a developer agreement and review.

### 8.3 Consequence for the code layout

The plugins currently live inside the core. Extracting them means moving each one into its own package
(`guestflow-plugin-<id>`), which is only possible once the extension points of §6 exist. The first
releases can ship the plugins as packages built from the same repository (monorepo `plugins/<id>/`),
published to the registry by the release workflow — the Sowel "one repo per plugin" layout is not
required.

## 9. Hosting model (D3)

### 9.1 How the market does it

Every commercial vacation-rental PMS is **multi-tenant SaaS billed per property and per month**; none
offers self-hosting:

| Product | Price observed 2026 |
|---|---|
| Smoobu | 35 €/month/property (31,50 € yearly) |
| Beds24 | 15,90 €/month base + 3 €/establishment + 1 €/unit |
| Lodgify | 18–77 $/month + 1,9 % per direct booking |
| Elloha (FR) | from 49 €/month, set-up fee 200–500 € |
| Amenitiz | 42–69 €/month |
| Hospitable | 29–99 $/month |

Sources and details in the research log of this study (bnbcalc, comparatifchannelmanager.fr,
beds24.com/pricing, roommaster.com). A gîte in France pays 30–60 €/month for one or two units.

### 9.2 Three architectures compared

| | (a) Shared DB + `tenant_id` | (b) One SQLite file per customer, one shared process | (c) One process per customer |
|---|---|---|---|
| Isolation | weakest — one forgotten `WHERE` leaks data | files separated, but one crash or slow query hits everyone (better-sqlite3 is synchronous) | **total**: memory, crash, key, file, version, plugins |
| Code change | rewrite of every query | ~75 files (74 `require('../database')`, 53 models binding statements at load), rewrite of `database.js`, schedulers, sessions, uploads, secrets, self-update | **almost none** — each install is already single-tenant; `scripts/bootstrap-vm.sh` already takes `ROOT`, `PORT`, `DB_PATH`, PM2 name |
| RAM per customer | ~0 | ~0,2 MB per open DB (measured) | ~120–130 MB (measured) |
| Downloaded plugins | shared by all | shared by all | **per customer** — a plugin only runs in the processes of customers who installed it |

### 9.3 Decision: (c), one process per customer, behind a thin control plane

- **Cost**: a Hetzner CX33 (8 GB, 8,49 € HT/month) holds ~50–60 customers with margin, a CX43 (16 GB,
  15,99 €) ~100 — about **0,15 € per customer per month**, negligible against a 30 € subscription.
- **Isolation**: each customer has its own process, SQLite file, encryption key, uploads directory,
  sessions and plugin set. A bug in one cannot read or crash another.
- **Shared releases**: one `releases/vX.Y.Z` directory (with its `node_modules`) shared by all
  customers; a customer only points to a version. Removes the per-customer `npm ci` (330 MB peak) and
  300 MB × 3 releases of disk.
- **Updates become an operator action** (fleet update, customer by customer, backup first, automatic
  rollback — `apply-update.sh` already does it for one). The in-app "Installer" button is hidden from
  customers.
- **Routing**: `<customer>.guestflow.fr` → Caddy → port; custom domains with Caddy on-demand TLS
  restricted to registered domains.
- **Backups**: Litestream on the data directory (it watches new databases, a case documented for
  multi-tenant apps), to EU object storage; restoring one customer = one file.
- **Control plane** (separate small app): customers, subscriptions and billing, provisioning
  (directory + key + PM2/systemd unit + Caddy route), plugin registry, fleet status and updates.

Move to (b) later only if density ever becomes the constraint (well beyond 100 customers per server).

### 9.4 What changes in the application anyway

| Item | Today | Needed |
|---|---|---|
| Google OAuth | callback built from each install's `publicUrl` (`googleOAuthClient.js:65-67`); Google refuses wildcard redirect URIs | one **central callback** (`auth.guestflow.fr`) resolving the customer from a signed `state`; one GCP project verified once by the publisher |
| Qonto OAuth | same (`qontoConfig.js:85`) | same central callback |
| Outbound email | SMTP configured per install; DKIM incident already paid | shared EU transactional provider (Scaleway TEM, Brevo), sender on a GuestFlow domain with `Reply-To` to the gîte; customer domain authentication as an option |
| `PUBLIC_API_KEY`, Qonto/Google env fallbacks | env of the install | per-customer settings |
| Self-update page | every admin can install | operator only |
| VAPID subject | `mailto:contact@domainesolio.com` | per customer |

### 9.5 GDPR

GuestFlow becomes a **processor** (art. 28 GDPR) of guest data; each gîte stays controller. Needed: a DPA
annexed to the SaaS contract, list of sub-processors (host, email provider), EU hosting only, export and
reversibility per customer, a tested restore, a record of processing activities.

## 10. Licence (D4)

- **Relicensing is possible.** A sole copyright holder can publish future versions under another
  licence (GNU FAQ *ReleaseUnderGPLAndNF*). Rights already granted under AGPL are irrevocable: versions
  ≤ v3.3.1 stay AGPL forever and can be forked.
- **Ownership (resolved 2026-09-28):** 196 commits carried `adrien.jouve@non.se.com`, a git misconfiguration
  of the owner's own machine, not an employer address. The whole history was rewritten on 2026-09-28 so
  every commit carries `Adrien Jouve <adrien.jouve@adn-dev.fr>` (Dependabot commits excepted), dates
  unchanged; the pre-rewrite history is kept in a local bundle.
- **Decision:** tag the last AGPL version, make the repository **private**, and publish future
  versions under a **proprietary licence** (customers use the hosted service under CGV/CGU; nothing is
  distributed). If transparency matters, the **FSL** (Functional Source License: no competing use,
  converts to Apache/MIT after two years) is the source-available alternative.
- **WordPress plugin:** a WordPress plugin is a derivative of WordPress and must stay **GPLv2+**
  (`integrations/wordpress/guestflow-booking/readme.txt:7`). It talks to GuestFlow over HTTP, so it does
  not contaminate the app. Keep it in a separate public repository, as a thin client.
- **Practical steps:** tag → private repo → new `LICENSE` + README → CLA for any
  outside contribution → CGV/CGU SaaS (service level, capped liability, reversibility, termination) →
  DPA → developer terms if the plugin marketplace opens → trademark "GuestFlow" at INPI.
- **Side effect:** the self-update and the WordPress plugin updater pull from the public GitHub
  releases of this repo (`releaseClient.js:15`, `class-gf-updater.php:126,155`). With a private repo
  and operator-driven updates (§9.3) the app updater is no longer needed for customers; the WP plugin
  updater moves to the public plugin repo.

## 11. Risks

1. **Pricing regressions.** Hourly resources, meals and Neat are inside a 1 440-line function that also
   back-solves the platform gross. The parity suites (`pricing-*`, `tourist-tax-*`, `sas-*`,
   `devis-extras-parity`) are the safety net; extraction must be behaviour-neutral for Solio.
2. **Frozen snapshots.** Accounting reads per-feature columns captured at payment flip (`*ContribTtc`,
   `complementAllocation`). Deactivating a plugin must never alter past entries.
3. **Deactivation with live data.** Turning off hourly resources while stays hold sessions: the UI
   disappears but the money must still be shown and exported.
4. **Plugin runtime contract.** Downloaded client bundles depend on the host's React/MUI versions; a
   core upgrade can break every plugin. The SDK must be versioned and the core version range enforced.
5. **Migration runner.** `database.js` executes at import time; the baseline replay order matters
   (incident noted at `database.js:27-35`). Per-plugin migrations need a runner that keeps that order.
6. **Solio production.** Every Solio feature must be installed and active after the upgrade.
7. **Scope.** Plugins, SaaS hosting and productisation together touch most of the code base and add a
   second application (control plane). Phasing is mandatory.

## 12. Suggested phasing

| Phase | Content | Value delivered |
|---|---|---|
| 0 — Foundation | plugin registry table, `GET /api/plugins`, `usePlugins()`, gating of menu/routes/settings/dashboard, the Plugins page (built-in plugins only), all plugins active on existing DBs | menu and dashboard slim down |
| 1 — SDK + isolated plugins | server `register(ctx)`, client slots and runtime, lifecycle events, job and migration registries; weather, school holidays, Google Calendar, tariff recipes, Sowel gate extracted as packages | the plugin contract exists and is proven |
| 2 — Hosts and middle | planning and SAS become hosts; linen, push, automatic emails, website booking, iCal, compensations, accounting export | reservation page, SAS and planning slim down |
| 3 — Pricing | price line contributors: hourly resources, breakfast & catering, Neat, then Qonto behind a payment-provider interface | a gîte without these sees a plain quote |
| 4 — Registry and download | package format, signed registry, install/update/uninstall from the Plugins page, core version ranges | plugins are downloaded, as in Sowel |
| H — Hosting (parallel) | licence switch, shared releases, provisioning script, Caddy routing, Litestream, central OAuth callback, transactional email, operator-only updates, control plane, CGV + DPA | a paying customer can be hosted |
| P — Productisation (parallel) | Solio content pack out of core, neutral seeds, onboarding wizard, account plan as data | a new customer starts from zero |

## 13. Open questions

1. **Deactivate vs uninstall:** keep data on deactivation, purge only on explicit uninstall?
   - **A (2026-09-28):** deactivating keeps everything. Uninstalling asks whether to erase the plugin's
     tables and settings. Money already recorded (price lines, payments, accounting entries) stays
     displayed and exported in every case.
2. **Solio content:** a "Solio" content pack applied to the Solio database only, or plain data edited
   in the UI?
   - **A (2026-09-28):** a **Solio content pack**, applied once to Solio's database at migration, kept
     outside the product repository. New customers start from neutral content.

## 14. Workstreams

The full checklist lives in the workstreams page; this section lists the items the study had not
named, so they are not lost.

| Stream | Item not in the study |
|---|---|
| Arbitration | subscription price and billing unit; product name and domain availability; French-only admin and EUR-only confirmed as the target market |
| Git | commit the study; delete the 453 stale local branches (owner's go needed); GitHub Support purge of `refs/pull/*` (owner) |
| Phase 0 | E2E suite run on two configurations: every plugin active, none active |
| Phase 1 | the gate-access feature merged in v3.4.0 (#623) and must now be extracted, not built as a plugin from scratch |
| Hosting | per-customer monitoring and alerts (process down, late backup, disk, certificate) |
| Security | self-service password reset (today only an admin can reset one); 2FA for admins; traced support access to a customer instance with consent |
| Productisation | customer help centre; demo instance |
| Legal & commercial | legal notice and privacy policy of the service; subscription billing tool; company status and publisher's professional liability insurance |
| Tooling | GitHub Actions minutes are only unlimited for public repositories: measure the unit + E2E consumption before going private |
