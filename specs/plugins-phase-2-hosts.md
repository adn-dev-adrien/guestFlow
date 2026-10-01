# Plugins — phase 2: the planning and the SAS become hosts, and four plugins move out of the core

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/plugins-phase-2` (from `inte/plugins`, after the master sync [#649](https://github.com/adn-dev-adrien/guestFlow/pull/649)) |
| **Created** | 2026-10-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened, target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §5.3 owner's split, §6 extension points, phasing §12 |
| **Previous phase** | [`specs/plugins-phase-1-sdk.md`](plugins-phase-1-sdk.md) (merged into `inte/plugins`, #632) |
| **Summary for review** | [`docs/specs/2026-10-01-plugins-phase-2-hosts.html`](../docs/specs/2026-10-01-plugins-phase-2-hosts.html) |

---

## 1. Context

Phase 1 built the plugin SDK and moved the five least entangled plugins into it. Seven plugins still
live inside the core behind the phase 0 switches. This phase moves four of them: linen & laundry,
accounting export, website booking (WordPress) and the guided arrival/departure (SAS). The three that
remain (hourly resources, Neat, Qonto) write price lines and payments; they move in phase 3, with the
price-line contributors and the payment-provider interface (study §12).

The mapping of the four (2026-10-01) found:

| Plugin | Server | Client | Couplings with the core |
|---|---|---|---|
| `linen` | 3 controllers, 5 models, 4 utils, 3 tables, 8 `app_settings` columns | 1 page, 5 components | 2 planning endpoints inside the core planning controller; the dashboard shortage alert; the core settings form; the SAS bed-linen and towel steps; the planning page loads and draws the laundry cards itself |
| `accounting-export` | 2 controllers, 2 models (1,200 lines, read-only), 1 pure engine, the account plan; **no table** | 2 pages | 6 routes inside `/api/accounting` next to the core compensations; 4 `app_settings` columns and 2 platform columns; the accountant role |
| `website-booking` | the whole `/public/v1` tree (5 route files, 6 controllers, 3 middlewares, 3 utils); **no table** | 2 components | mounted by `index.js` before the core; the API key created at every boot; the dashboard alert; the CGV page's « Réservation en ligne » card |
| `sas` | 1 controller (430 lines), the SAS commit inside `reservationsModel` (530 lines of money code) | 1 dialog (2,000 lines), 4 components | opened from three core pages; its steps read breakfast, catering, cleaning, payment, caution, linen and hourly-resource data; the reception role |

It also found **six paths that still run while their plugin is off** (the client hides them, the
server does not):

1. `GET /api/dashboard/linen-shortage` answers without `linen`.
2. `GET /api/dashboard/public-devis-pending` answers without `website-booking`.
3. `GET/PUT /api/settings/linen-items` and `/repair-amounts` (the « Facturables au SAS » prices) answer
   without `sas`.
4. The « À venir » page opens the arrival SAS without `sas`.
5. The SAS payload carries the linen data, and the SAS commit accepts the linen and towel decisions,
   without `linen`.
6. The arrival/departure push links to `/planning?sas=…` without `sas`.

**The SAS commit stays in the core.** Arrival and departure write the stay's money: payments at the
door, complement lines, the caution, the end-of-stay settlement. That code keeps its tests and its
place (`reservationsModel.commitArrivalSas` / `commitDepartureSas`). The SAS plugin owns the routes,
the controller that reads and orchestrates, the dialog and the settings; it calls the commit through
the SDK. The same holds for the accounting export: its journal is computed from core money data it
reads, never writes.

Owner's decisions (2026-10-01, questionnaire):

- **P5** — one pull request for the whole phase, onto `inte/plugins`.
- **P6** — the towel step of the SAS (bath linen offered or sold at check-in) belongs to **linen**, as
  in phase 0: without `linen`, the step is gone.
- **P7** — the cancellation compensations get a core page of their own in Suivi financier. Their
  account number and VAT rate, which only the export reads, move with `accounting-export`.
- **P8** — the CGV bug found during the mapping (a converted website request lost the display of its
  acceptance) is fixed on its own on `master`:
  [#648](https://github.com/adn-dev-adrien/guestFlow/pull/648), `specs/terms-acceptance-record.md`
  rule 29.

Before this phase, `inte/plugins` was brought up to date with `master` v3.8.0
([#649](https://github.com/adn-dev-adrien/guestFlow/pull/649)). The lost-items feature was removed
there (#628), so it is not part of the SAS plugin. The « configurable departure checklist » of the
study does not exist yet; the departure keeps its extinguisher check.

## 2. Goal

Nothing changes for the person using GuestFlow while all plugins are installed, apart from one new
page: « Indemnités d'annulation » in Suivi financier. Each of the four plugins, once uninstalled,
leaves no trace on screen **and none on the server**. Three of them can erase their data. Behind that,
the planning and the SAS are hosts: a plugin adds cards to the planning and steps to both SASes
without the core knowing it.

## 3. Functional rules

### 3.A The SDK grows

1. Four new modules join the lists of phase 1 rule 2: `linen`, `accounting-export`, `website-booking`
   and `sas`. After this phase, nine of the twelve plugins have a module. `hourly-resources`, `neat` and
   `online-payment` keep the phase 0 behaviour until phase 3.
2. **The SDK exposes what the four need, and nothing else.** `plugins/sdk/index.js` gains, each with a
   one-line reason in the file:
   - core models bound to a database: reservations (read, the SAS commit, the reception view),
     breakfast, options, repair amounts, linen priced items, resource scheduling, platforms, refunds by
     month, compensations received by month, devis (create), clients (find or create), terms (current
     version, acceptance), settings (read);
   - the pricing helpers the public quote and the journal use, availability and capacity, the
     translation resolver;
   - the shared public helpers (`publicLabels`, `publicDevisToken`, `attributionChannel`), the
     booking-request rate limiter and `closedWhenReadOnly`;
   - the public pay/status handlers of `online-payment`, which stay core until phase 3 (rule 21).

   The isolation walk of phase 1 rule 3 applies to the four folders unchanged.
3. **`ctx.roleAccess(role, entries)`** replaces `ctx.reception(entries)`, which stays as its shorthand.
   `role` is `reception` or `accountant`. `enforceRoleAccess` merges the entries of live plugins with its
   own lists:
   - the accountant allowlist (reads of `/api/accounting/*`, `PUT /platform-accounts`,
     `POST /platform-accounts/refresh`) leaves the core and moves to `accounting-export`. The read of the
     compensations stays core;
   - the reception entries of the SAS (`GET /:id/sas`, both commits) move to `sas`; those of the laundry
     move to `linen`. The core keeps the planning reads, the reservation reads and the option-card
     toggles.

### 3.B The planning is a host

4. **Server.** The planning stays core: breakfast summary, option cards, and (until phase 3) the resource
   cards. `GET /api/planning/laundry` and `GET /api/planning/linen-inventory` move into `linen` through
   `ctx.route`, at the same URLs.
5. **Client — slot `planning.days`.** A data contribution:

   ```
   { key, order, load({ from, to }) → Promise<{ [date]: entry }>, Component, rank }
   ```

   - `PlanningPage` calls `load` for the window it shows, and again for each window the infinite scroll
     adds. The dates a contribution returns join the day set, like the breakfast and option dates.
   - For each date, it renders `<Component date entry reload />` at the position `rank` gives among the
     day's cards (`planningDayOrder`). `reload()` reloads that contribution only.
   - Dialogs belong to the component that opens them.
6. **Client — slot `planning.actions`.** Buttons of the page's action bar, as components receiving
   `{ reload }`. The laundry contributes « Tournée supplémentaire ».
7. The laundry card, its dialogs and its loads leave `PlanningPage`. Its day-task count follows the
   card (the « tâches du jour » chip counts what the page renders).

### 3.C The SAS is a plugin and a host

8. **The `sas` module owns:**
   - the routes `GET /api/reservations/:id/sas`, `POST …/sas/arrival`, `POST …/sas/departure`
     (`ctx.route`, same URLs) and its reception entries (rule 3);
   - the « Facturables au SAS » prices, `GET/PUT /api/settings/linen-items` and `/repair-amounts`, now
     behind the plugin (gap 3);
   - `sasController`, `sasAudit` and `sasEditWindow`, moved;
   - the dialog and its components (`components/sas/*`), moved to `client/src/plugins/sas/`.
     `SasKeypadCode` stays exported by the client SDK for `gate-access`.
9. **Opening the SAS.** The core renders `<Slot name="sas.dialog" reservationId mode open onClose onDone />`
   where it rendered the dialog: the planning, and the « À venir » page. The buttons that open it ask
   whether `sas` is active, as phase 0 does (the core may ask, never import). On « À venir » they now do
   (gap 4).
10. **Step slots.** `sas.arrival.steps` gains `after: '<stepKey>'`, and a new slot `sas.departure.steps`
    takes the same shape. A step without `after` stays just before the recap, as in phase 1. Steps
    contributed through these slots show data and collect nothing. Weather keeps its arrival step.
11. **The linen and towel steps stay in the SAS, under `linen` (P6).** They write complement lines, the
    stay's money, inside the single commit. A generic commit contract for contributed steps comes with
    phase 3's price-line contributors, where hourly resources need it too. Until then:
    - `getSas` sends `linenItems`, `bathLinen` and the reservation's `bedLinenAlert` **only while
      `linen` is live**. The dialog shows the steps when the payload carries them; it no longer asks
      `usePlugin(LINEN)` (gap 5);
    - `POST …/sas/arrival` ignores `bathLinenAdded`, `bathLinenOffered` and the bed-linen lines while
      `linen` is not live;
    - the departure « Objets manquants » steps (towels, sheets, items priced in « Facturables ») are SAS
      steps, not linen ones. They stay shown without `linen`, as today.

    The hourly-resource scheduling step keeps its phase 0 switch until phase 3.
12. **The arrival/departure push** links to `/planning?sas=<id>` while `sas` is live, and to the
    reservation's page otherwise (gap 6).
13. **« Accueil » (reception role)** stays a core role constant. The role picker offers it while `sas` is
    active, and the plugin cannot be turned off while a reception-only account exists (phase 0, unchanged).
14. **Erasure.** `sas` declares no erasable data: everything the SAS records is part of the stays
    (payments, caution, complement lines, breakfast composition, the arrival and departure instants).
    Its Plugins card shows no « Effacer aussi ses données » checkbox (phase 1 rule 22). The « Facturables »
    prices stay too: they are used again on reinstall.

### 3.D Linen & laundry

15. **The `linen` module owns:**
    - `/api/laundry/*`, the two planning endpoints (rule 4) and `GET /api/dashboard/linen-shortage`, now
      behind the plugin (gap 1);
    - the tables `laundry_trip_skips`, `laundry_trip_manual_additions` and `laundry_extra_trips`, as
      migrations (phase 1 rule 6);
    - eight settings, moved to `plugin_settings` (rule 26): `laundryWeekday`, `bedLinenStockSingle`,
      `bedLinenStockDouble`, `bedLinenStockBaby`, `towelStockLarge`, `towelStockMedium`,
      `towelStockSmall`, `towelStockBathMat`;
    - the page `/parametres/stock-blanchisserie` (« Linge »), as a contributed route and a `settings.menu`
      entry. It saves through `/api/plugins/linen/settings`; the core settings form loses its `laundry`
      and `linenStock` groups;
    - the shortage alert, as a `dashboard.alerts` contribution;
    - the planning card and button (rules 5-6), and the laundry reception entries.
16. **What stays core:** the linen options and their flags (`countsAsBedLinen`, `linenIncludes*`,
    `towel*PerPerson`, `countsAsBathMat`, `displayToClient`), the seeded linen options, the bath mats per
    property, the beds of each stay, « Lits à préparer » and the bed inputs of the fiche, the email
    variables about the bed-linen option. They describe what is sold and booked; a gîte without laundry
    management still sells sheets.
17. **The bed-linen alert** (« Linge insuffisant », a stay with more beds than its linen option covers) is
    computed on the server only while `linen` is live. Without it, the planning cards and the SAS show no
    such chip.
18. **Erasure** (« Effacer aussi ses données »):

    | Erased | Kept |
    |---|---|
    | the skipped trips, manual additions and extra trips; the stock and the laundry day | every option, price and booked linen line; the beds of each stay; the « Facturables » prices (SAS) |

    `describe()` lists « 3 tournées sautées · 2 ajouts manuels · 1 tournée supplémentaire · le stock et le
    jour de blanchisserie ». Lines with a count of zero are left out.

### 3.E Accounting export

19. **The `accounting-export` module owns:**
    - `GET /api/accounting/sales.csv`, `/sales`, `/platforms` and the three `/platform-accounts` routes
      (`ctx.route`, same URLs). The compensation routes under `/api/accounting/cancellation-compensations`
      stay core;
    - the pages « Comptabilité » (`/comptabilite`) and « Plan comptable » (`/comptabilite/plateformes`),
      as contributed routes and entries of a new slot `finance.menu` (Suivi financier submenu);
    - the account plan, the journal engine and the CSV writer. The generic `utils/csv.js` stays core;
    - the accountant's allowlist (rule 3) and the accountant's landing on `/comptabilite`;
    - the links « Plan comptable » of the Plateformes and TVA settings pages, as a slot
      `settings.platforms.links`;
    - four settings, moved to `plugin_settings` (rule 26): `defaultCommissionAccountNumber`,
      `vatRateCommission`, `cancellationCompensationAccount`, `vatRateCancellationCompensation` (P7).
20. **The platform columns** `commissionAccountNumber` and `hasVatOnCommission` stay on `platforms`,
    declared by the core, as the recipe columns of phase 1 rule 6. Only the plugin reads and writes them.
21. **« Indemnités d'annulation » (P7)** — a core page `/finance/indemnites` in Suivi financier, after
    « Taxe de séjour »:
    - it holds the existing `CancellationCompensationsSection` with a month picker: the compensations
      banked in the month, and the pending ones whatever the month;
    - « Ajouter », « Encaisser », « Rouvrir », « Modifier » and « Supprimer » for the admin; read-only for
      an accountant (rule 3), who still reaches it while `accounting-export` is live;
    - the Comptabilité page loses the section and gains a link « Indemnités d'annulation → » under the
      journal. The journal still carries their entries.
22. **Erasure:**

    | Erased | Kept |
    |---|---|
    | the four account and VAT settings (back to 622600, 20 %, 75880000, 0 %); each platform's commission account and « TVA déductible » box | every payment, refund, compensation and stay; the CSVs already sent |

    Nothing is stored as accounting: a reinstall shows the same journal for the same months.
    `describe()` lists « les comptes de 4 plateformes · les comptes et taux par défaut ». Phase 0 rule 8
    still refuses an uninstall while an accountant-only account exists.

### 3.F Website booking (WordPress)

23. **The `website-booking` module owns `/public/v1`, except `/public/v1/gate`.**
    - It mounts five public prefixes: `/public/v1/properties`, `/terms`, `/quote`, `/booking-requests`
      and `/plugin-update`. The paths are an external contract with the WordPress plugin and do not
      change.
    - Each prefix runs the same chain as today: API key, visitor context, then the public limiter.
      `/public/v1/gate` keeps its own mount and signature.
    - `/booking-requests/:id/pay` and `/status` stay behind `online-payment` too. The plugin mounts the
      core handlers the SDK hands it (rule 2); Qonto takes them over in phase 3.
24. **The API key** (`PUBLIC_API_KEY` in `.env.local`) is created when the plugin is installed, and at
    boot only if it is installed, as the Sowel connector keys (phase 1 rule 18). Uninstalling, with or
    without erasure, never rotates it.
25. **Admin side:**
    - `GET /api/dashboard/public-devis-pending` moves into the plugin (gap 2), and its alert « Demandes du
      site » becomes a `dashboard.alerts` contribution;
    - `PUT /api/terms/enforcement` moves into the plugin. `requireTermsAcceptance` and
      `lastSeenPluginVersion` move to `plugin_settings` (rule 26). They leave the CGV overview;
    - the CGV page's « Réservation en ligne » card and its two alerts (« la réservation en ligne est
      fermée », « plugin WordPress trop ancien ») become a slot `terms.settings`.
26. **What stays core:**
    - writing and publishing the CGV, and the acceptances (`terms_acceptances`, legal records);
    - the fiche's CGV line, which reads core data and stays behind `usePlugin(WEBSITE_BOOKING)`;
    - `requestOrigin` and the attribution columns, read by pricing and by Suivi financier;
    - the devis origin badge and filter, behind `usePlugin` as today;
    - the « Nouvelle demande de devis » notification.
27. **Erasure:** the two settings (the CGV requirement back to « on », the last WordPress plugin version
    seen). `describe()` lists « le réglage d'exigence des CGV · la dernière version du plugin WordPress
    vue ». Every devis, reservation, acceptance and token is kept. The API key is kept (rule 24).

### 3.G Existing databases, new customers

28. **Existing database (Solio):**
    - the laundry tables exist; the migrations of `linen` find them;
    - the one-shot migration `plugin_settings_from_app_settings_v2` copies the eight linen, four
      accounting and two website settings into `plugin_settings`. Empty values are not copied;
    - the old `app_settings` columns stay in place, unread, for one release, as in phase 1 rule 25.
29. **New database:** the three laundry tables leave the baseline (`schema.sql`, `database.js`). They
    appear when `linen` is installed. A new customer who never installs `website-booking` has no public
    API key.

**Edge cases:**
- **`linen` deactivated with laundry trips planned.** The planning shows no laundry card; reactivating
  it shows them again, skips and additions intact.
- **`sas` deactivated during a stay whose arrival SAS is done.** The fiche still shows everything the
  SAS recorded (payment, complement, caution). The departure is closed from the fiche, as for a stay
  without the SAS.
- **`accounting-export` deactivated while the accountant is logged in.** Their next call answers 404
  `PLUGIN_INACTIVE`, and the app sends them to « Mon compte » (phase 0 confinement).
- **WordPress calls `/public/v1/…` while `website-booking` is off.** 404 `PLUGIN_INACTIVE`, as the phase 0
  gate answers today. The site's booking form shows its existing « indisponible » message.
- **A planning contribution fails to load.** Its cards are missing and a toast says « Le linge n'a pas pu
  être chargé. »; the other cards render.
- **A copied setting is edited, then the release is rolled back.** The rollback reads the old column,
  frozen at the migration's value: the edit is lost. This is phase 1's rollback contract.

---

## 4. Architecture

> **Fat backend, thin frontend.** The linen gating of the SAS, the bed-linen alert, the push target,
> the erasure lists and the planning entries are computed on the server. The client renders slots.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `index.js` | T | The core models, helpers and handlers of rule 2 |
| `plugins/sdk/` | `createContext.js`, `registry.js` | T | `roleAccess(role, entries)`; `reception` as its shorthand |
| `plugins/` | `loader.js` | T | `roleMatchers(role)`; public mounts in list order, `gate-access` before `website-booking` |
| `plugins/` | `index.js` | T | + `linen`, `accounting-export`, `website-booking`, `sas` |
| `plugins/linen/` | `index.js`, `routes.js`, `planningController.js`, `shortageController.js`, `skipsController.js`, `manualAdditionsController.js`, `extraTripsController.js`, `laundryModel.js`, `linenInventoryModel.js`, `skipsModel.js`, `manualAdditionsModel.js`, `extraTripsModel.js`, `linenInventory.js`, `laundryTripLedger.js`, `laundryWindow.js`, `settings.js`, `tests/` | C (moved) | Laundry, stock, shortage; settings in `plugin_settings`; erasure |
| `plugins/accounting-export/` | `index.js`, `controller.js`, `platformAccountsController.js`, `accountingModel.js`, `platformAccountsModel.js`, `accountingExport.js`, `accountPlan.js`, `settings.js`, `tests/` | C (moved) | Journal, CSV, account plan; accountant access; erasure |
| `plugins/website-booking/` | `index.js`, `routes/*.js`, `controllers/*.js`, `requirePublicApiKey.js`, `visitorContext.js`, `publicInputValidation.js`, `publicProjections.js`, `publicPaymentMode.js`, `enforcementController.js`, `pendingController.js`, `tests/` | C (moved) | `/public/v1` (except gate), API key, dashboard alert, CGV enforcement; erasure |
| `plugins/sas/` | `index.js`, `controller.js`, `sasAudit.js`, `sasEditWindow.js`, `billablesController.js`, `tests/` | C (moved) | SAS routes and controller, « Facturables » prices, reception entries |
| `models/` | `reservationsModel.js` | T | `bedLinenAlert` only while `linen` is live; the commit ignores linen fields otherwise |
| `controllers/` | `planningController.js`, `dashboardController.js`, `settingsController.js`, `termsController.js` | T | Laundry, shortage, `laundry`/`linenStock` groups, enforcement and plugin fields removed |
| `middleware/` | `enforceRoleAccess.js` | T | Accountant and SAS/laundry reception entries from live plugins |
| `utils/` | `arrivalDeparturePushRunner.js` | T | Deep link by `sas` state (rule 12) |
| `utils/` | `pluginsSchema.js` | T | `plugin_settings_from_app_settings_v2` |
| `utils/` | `laundryWindow.js` → `dateDays.js` | T | `addDays`, used by `breakfastModel`, stays core |
| `routes/` | `accounting.js`, `planning.js`, `dashboard.js`, `settings.js`, `reservations.js`, `terms.js` | T | Plugin routes out |
| `index.js`, `database.js`, `schema.sql` | | T | `/public/v1` and `/api/laundry` mounts and the API key out; laundry tables out of the baseline |
| `scripts/seed-e2e.js` | | T | Creates the tables of the new modules |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/` | `index.js` | T | + the four modules |
| `plugins/linen/` | `index.js`, `LinenStockPage.jsx`, `SettingsLaundrySection.jsx`, `LinenShortageAlert.jsx`, `LaundryDayCard.jsx`, `LaundryExtraTripDialog.jsx`, `LaundryManualAdditionsDialog.jsx`, `ExtraTripButton.jsx`, `planningDays.js`, `formatLinen.js`, `__tests__/` | C (moved) | Route, menu, dashboard alert, planning card and button |
| `plugins/accounting-export/` | `index.js`, `AccountingPage.jsx`, `PlatformAccountsPage.jsx`, `PlatformAccountsLink.jsx`, `__tests__/` | C (moved) | Routes, `finance.menu`, links |
| `plugins/website-booking/` | `index.js`, `DevisPublicRequestAlert.jsx`, `OnlineBookingCard.jsx`, `__tests__/` | C (moved) | Dashboard alert, CGV page card |
| `plugins/sas/` | `index.js`, `ReservationSasDialog.jsx`, `SasResourceSchedulingPage.jsx`, `SasStayPaymentPage.jsx`, `OfferableLine.jsx`, `BillableAmountsTab.jsx`, `__tests__/` | C (moved) | The dialog (`sas.dialog`), the « Facturables » tab |
| `plugins/sdk/` | `index.js` | T | + `MonthYearPicker`, `ResponsiveTable`, `PlatformChip`, `OptionDayCard` and the formatters the moved pages use |
| `components/sas/` | `SasKeypadCode.jsx` | — | Stays, exported by the SDK |
| `pages/` | `CompensationsPage.jsx` | C | « Indemnités d'annulation » (rule 21) |
| `pages/` | `PlanningPage.jsx` | T | `planning.days` and `planning.actions`; laundry code out; `sas.dialog` |
| `pages/` | `ReservationsUpcomingPage.jsx` | T | SAS buttons behind `usePlugin(SAS)`; `sas.dialog` |
| `pages/` | `Dashboard.jsx`, `OptionsResourcesPage.jsx`, `settings/TermsSettingsPage.jsx`, `settings/PlatformsSettingsPage.jsx`, `settings/VatFiscalSettingsPage.jsx` | T | Slots instead of phase 0 gates |
| `App.jsx` | | T | `finance.menu` entries; `/finance/indemnites`; the moved routes come from modules |
| `constants/` | `plugins.js`, `roles.js`, `settingsMenu.js` | T | Hand-written entries of the four removed |
| `hooks/`, `utils/` | `useSettingsForm.js`, `planningDayOrder.js`, `planningDayTasks.js` | T | `laundry`/`linenStock` groups out; contributed entries ranked and counted |
| `api.js` | | T | Laundry and accounting wrappers stay until phase 4 (phase 1 rule 16); + compensations page call |

**Component reuse declaration:** `CompensationsPage` reuses `CancellationCompensationsSection`,
`MonthYearPicker` and `PageActionBar`. The planning slots are generic. No new generic component.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/plugins` | `linen`, `accounting-export`, `website-booking` gain `hasModule`, `erasable: true`, `data`; `sas` gains `hasModule`, `erasable: false` |
| DELETE | `/api/plugins/:id?purge=1` | accepted for the three erasable modules (rules 18, 22, 27) |
| GET/PUT | `/api/plugins/linen/settings` | the eight linen settings |
| GET/PUT | `/api/plugins/accounting-export/settings` | the four account settings (the Plan comptable page) |
| GET/PUT | `/api/plugins/website-booking/settings` | `requireTermsAcceptance` (write), `lastSeenPluginVersion` (read) |
| GET/PUT | `/api/settings` | the `laundry` and `linenStock` groups disappear |
| GET | `/api/terms` | `requireTermsAcceptance`, `lastSeenPluginVersion`, `pluginOutdated` disappear |
| GET | `/api/reservations/:id/sas` | `linenItems`, `bathLinen`, `reservation.bedLinenAlert` only while `linen` is live |
| GET | `/api/reservations`, `/api/reservations/:id` | `bedLinenAlert` only while `linen` is live |
| — | every moved URL | **unchanged**, now 404 `PLUGIN_INACTIVE` while its plugin is off (gaps 1-3) |

## 5. Data model

No new table. No column added or dropped.

**Migration `plugin_settings_from_app_settings_v2`** (ledger, runs once), same contract as v1:

| `app_settings` column | → plugin | key |
|---|---|---|
| `laundryWeekday`, `bedLinenStockSingle`, `bedLinenStockDouble`, `bedLinenStockBaby`, `towelStockLarge`, `towelStockMedium`, `towelStockSmall`, `towelStockBathMat` | `linen` | same name |
| `defaultCommissionAccountNumber`, `vatRateCommission`, `cancellationCompensationAccount`, `vatRateCancellationCompensation` | `accounting-export` | same name |
| `requireTermsAcceptance`, `lastSeenPluginVersion` | `website-booking` | same name |

**Tables that move from the core baseline to plugin migrations:** `laundry_trip_skips`,
`laundry_trip_manual_additions`, `laundry_extra_trips` (`linen`).

**Data impact:** no row changes on an existing database, apart from the settings copy. Rolling back to
v3.8 finds every old column intact.

## 6. UI / UX

While all plugins are installed, two things change on screen. Both are in the summary page,
interactively.

1. **Suivi financier → « Indemnités d'annulation »** (rule 21):
   - a new submenu entry after « Taxe de séjour »;
   - the page has a `PageActionBar` (« Indemnités d'annulation », the month picker centred,
     « Ajouter »), then the existing card: « Encaissées en <mois> » and « En attente »;
   - on Comptabilité, the section is replaced by a link « Indemnités d'annulation → ».
2. **Plugins page**:
   - « Effacer aussi ses données » appears on Linge, Export comptable and Site WordPress, with the lists
     of rules 18, 22 and 27;
   - Arrivée et départ guidés shows no checkbox (rule 14).

Uninstalling a plugin now also removes, without a phase 0 gate in the page:
- **`linen`:** the laundry card and button of the planning, the « Linge insuffisant » chip, the linen and
  towel steps of the SAS, the shortage alert, Paramètres › Linge;
- **`accounting-export`:** Comptabilité and Plan comptable from Suivi financier, the « Plan comptable »
  links of Plateformes and TVA;
- **`website-booking`:** the « Demandes du site » alert, the « Réservation en ligne » card of the CGV page;
- **`sas`:** the SAS buttons, including those of « À venir », and the « Facturables au SAS » tab.

**Responsive:** on `xs`, the month picker of « Indemnités d'annulation » moves to the bar's second row
(`PageActionBar` default) and the card's tables become stacked rows (`ResponsiveTable`). The planning
renders contributed cards in the same column as its own. Nothing else moves.

## 7. Test plan

### Server — `server/src/tests/plugins-phase-2-hosts.unit.test.js`
- **Modules (rules 1-2):** the nine modules listed; the isolation walk covers the four new folders.
- **Role access (rule 3):** the accountant reaches the export only while `accounting-export` is live and
  still reads the compensations; reception reaches the SAS and the laundry only while their plugins are
  live; `reception()` still works.
- **Planning (rule 4):** the two laundry endpoints answer 404 while `linen` is off; the breakfast and
  option-card endpoints are untouched.
- **SAS (rules 8, 11, 12):** the SAS and « Facturables » routes answer 404 while `sas` is off (gap 3); the
  payload without `linen` carries no linen data, and the commit ignores linen fields (gap 5); the push
  target follows `sas` (gap 6).
- **Linen (rules 15, 17, 18):** the shortage endpoint answers 404 while off (gap 1); `bedLinenAlert`
  absent while off; `data` lines skip zero counts; the purge empties the three tables and the eight
  settings and keeps the options.
- **Accounting (rules 19-22):** compensation routes reachable while off; the four settings read from
  `plugin_settings`; the purge resets the settings and the platform columns, and the journal is
  identical after a reinstall.
- **Website booking (rules 23-27):** `/public/v1/*` answers 404 `PLUGIN_INACTIVE` while off, and
  `/public/v1/gate` still answers; pay/status need both plugins; the API key is created on install
  only; the pending endpoint answers 404 while off (gap 2); enforcement reads `plugin_settings`; the
  purge keeps devis and acceptances.
- **Migration (rules 28-29):** v2 copies the fourteen settings once, byte for byte; empty values are
  skipped; a new database has no laundry table before install.

### Moved tests
The tests of the four plugins move with their code into `server/src/plugins/<id>/tests/` and
`client/src/plugins/<id>/__tests__/`, with their imports updated and their assertions unchanged, except
where a rule above changes a behaviour (the linen settings saved through the plugin, the CGV overview
fields). The phase 0 source-string assertions on `index.js` and the route files cover the three plugins
still in the core.

### Client (Vitest)
- `plugins/sdk/__tests__/registry.phase-2.test.jsx` — the four modules; `planning.days` merges dates,
  ranks the cards and reloads one contribution; `planning.actions`; `finance.menu`; `terms.settings`;
  `sas.departure.steps` and `after`.
- `pages/__tests__/CompensationsPage.test.jsx` — month picker, admin actions, accountant read-only.
- `pages/__tests__/ReservationsUpcomingPage.sas-gate.test.jsx` — gap 4.
- `components/__tests__/PluginCard.erasure.test.jsx` — + the three lists and no checkbox on `sas`.

### E2E
- `plugins/plugins-page.spec.js`: + `linen` uninstalled with erasure: the planning has no laundry card;
  reinstalled: the stock reads 0.
- The full suite runs unchanged.

### Manual verification (shadow on port 4101, upgrade from v3.8)
- **Upgrade path:** the fourteen settings copied; the three laundry migrations recorded on the existing
  tables; the planning, the SAS, Comptabilité, Plan comptable and the CGV page unchanged.
- **Each plugin off, one at a time:** no trace on the screens of §6 and the gap endpoints answer 404.
- **`linen` erased and reinstalled; `accounting-export` erased and reinstalled** (same journal for
  September 2026).
- **WordPress:** a quote and a booking request through the local plugin against the shadow.
- **375 px:** « Indemnités d'annulation », the planning with the laundry card, the Plugins page.

## 8. Out of scope

- **Hourly resources, Neat, Qonto:** phase 3, with the price-line contributors and the payment-provider
  interface. Their phase 0 switches stay where they are, including in the SAS and the planning.
- **A commit contract for contributed SAS steps:** phase 3 (rule 11).
- **The configurable departure checklist:** it does not exist yet; it will be specified on its own.
- **Moving the linen options out of the core:** they are sold and booked (rule 16).
- **Downloads:** phase 4.
- **Dropping the old `app_settings` columns:** in a later release.

## 9. Open questions

None at this stage. P5–P8 were decided by the owner on 2026-10-01 (§1).
