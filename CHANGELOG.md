# Changelog

All notable changes to GuestFlow are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Arithmetic input on reservation price fields** (spec
  `reservation-price-arithmetic.md`, 2026-06-08). The « Prix hébergement
  ajusté » and « Prix payé par le client » fields now accept arithmetic
  expressions (`100+20`, `(100+20)*2`, French comma OK): on Enter or blur
  the expression is evaluated and the result set (rounded to 2 decimals,
  clamped ≥0); invalid input reverts. New safe (no-`eval`) evaluator
  `utils/arithmetic.js` + reusable `ArithmeticTextField` component.
  +15 client tests.
- **Dashboard card — new iCal reservations imported today** (spec
  `dashboard-ical-new-reservations.md`, 2026-06-08). A read-only blue
  card on the dashboard lists every reservation imported via iCal during
  the current (UTC) day — guest, property, platform/source, stay dates,
  and a relative "imported X ago". Clicking a row opens the reservation
  page. The card auto-rolls daily (no acknowledge / no new table) and is
  hidden when nothing was imported. New `GET /api/dashboard/ical-new-today`
  + `IcalNewReservationsAlert` component. +7 server tests, +5 client tests.

### Fixed
- **Bed-linen default now appears on iCal-arrived reservations** (spec
  `bed-config-in-linen-card.md` §10 follow-up #5, 2026-06-08). The iCal
  sync created a bare reservation and skipped the property's option
  defaults, so on "Gite" (bed linen is an *offered* default) a freshly
  imported booking showed no bed-linen option. The sync now applies the
  property's option defaults to each new iCal reservation, marked
  `offered` per the property setting (pricing stays 0 until the operator
  edits). +2 tests.
- **"Lit bébé" counter is back whenever there are babies** (spec
  `bed-config-in-linen-card.md` §10 follow-up #6, 2026-06-08). Since bed
  counters moved into the "Linge de lit" option card, the baby-bed
  counter was hidden when no bed-linen option was enabled. A baby bed is
  an independent resource: it now lives in the **Voyageurs** card and
  shows whenever `babies > 0`, with its live availability ("Dispo
  restante") from the *Lit bébé* resource — capped at 0 when other
  reservations have booked every baby bed for the dates. The server
  invariant no longer zeroes `babyBeds` without a linen option (safe:
  laundry gates the baby-linen aggregation on the option separately).
  +4 server availability tests, +4 client display tests.
- **Mobile calendar now fits the screen width** (spec
  `calendar-mobile-view.md`, 2026-06-08). The main content area
  (`<Box component="main">`) lacked `minWidth: 0`, so the week strip's
  non-shrinkable full-width pages stretched the page wider than the phone
  (page-level horizontal scroll). Added `minWidth: 0` on `main` (+ a
  `width/maxWidth: 100%` guard on the week-view card); the page fits the
  viewport and only the week strip scrolls horizontally.

### Added
- **Mobile-friendly calendars** (spec `calendar-mobile-view.md`,
  2026-06-08). On phones (`xs`), the reservation calendar (`/calendar`)
  shows a new **week view**: one week per full-width page with the 7 days
  as readable vertical rows (arrival / departure / ongoing stay / devis /
  closure / note), and **horizontal swipe to move between weeks**. Desktop
  keeps the month grid unchanged. The property mini-calendars now scroll
  horizontally on a phone instead of squishing. New `CalendarWeekView`
  component + pure `calendarDaySummary` helpers.

### Changed
- **Responsive rework of the Paramètres pages** (specs `settings.md`,
  `linen-inventory-shortage-tracking.md`, `establishment-closures.md`,
  2026-06-08). The Paramètres page and the Stock blanchisserie page now
  use a CSS **masonry** (1 column ≤ md, 2 balanced columns on lg+) inside
  a wider centered container (`maxWidth lg: 1240`), so small sections no
  longer waste the desktop width; both stay single-column + mobile-friendly
  on phones. The Fermetures table container widened (920 → 1200 on lg).
  Pages already full-width + responsive (Logements grid, Clients / Options
  / Ressources via DataPageScaffold, Comptes) were left unchanged. Vacances
  scolaires excluded by request.

### Added
- **Bilingual devis PDF (FR / EN)** (spec
  `devis-english-language.md`, 2026-06-06). The devis edit page gains a
  small **FR / EN** toggle next to the Statut select; the choice is
  persisted on the row (`reservations.pdfLanguage`, default `'fr'`) and
  drives the `GET /api/devis/:id/pdf` rendering. Every literal the PDF
  prints flows through `utils/devisPdfLabels.js` (one source of truth
  for both languages, with FR ↔ EN key parity asserted by unit tests).
  Dates render in `dd/mm/yyyy` for FR and `D MMMM YYYY` for EN
  (unambiguous internationally) via a new `formatDateLocalised` helper.

  **Translated options & resources.** Options gain a single `titleEn`
  column (no `descriptionEn` — the option description isn't printed in
  the devis PDF, only the title is). Resources gain `nameEn`. The
  OptionsPage and ResourcesPage forms expose the EN inputs side-by-side
  with the FR ones; empty values fall back to the FR text at render time
  so existing prod data keeps producing usable PDFs. The **5 typed-
  default options** seed their EN title at boot — both on fresh installs
  and as an idempotent backfill on prod servers that promoted before
  the column existed:

  | autoOptionType | titleEn |
  |---|---|
  | `bed_linen` | Bed linen |
  | `bathroom_linen` | Bath linen |
  | `breakfast` | Breakfast |
  | `early_check_in` | Early check-in |
  | `late_check_out` | Late check-out |

  The default `Lit bébé` resource seeds with `nameEn = 'Baby bed'`.

  **Footer.** A new `quoteFooterTextEn` setting sits beside the existing
  `quoteFooterText` in `/settings`; each language uses its own custom
  footer when set, else a sensible static default in the matching
  language (no cross-language fallback — an EN PDF showing French
  copy would read as broken).

  **Coverage.** +52 server-side cases (`devis-pdf-labels`,
  `devis-helpers-date-en`, `devis-pdf-en`, `devis-model-pdf-language`,
  `options-resources-en-fields`, `seeds-en-translation`) + +16 Vitest
  cases (`SettingsQuoteSection.bilingual`,
  `devis-en-language-payload`). Server suite stable at ~1115; client
  suite 284 → 300 green.

  **Migration.** `reservations.pdfLanguage TEXT NOT NULL DEFAULT 'fr'`,
  `options.titleEn TEXT NOT NULL DEFAULT ''`,
  `resources.nameEn TEXT NOT NULL DEFAULT ''`,
  `app_settings.quoteFooterTextEn TEXT DEFAULT ''`. Additive; no row
  rewrites. The model factories (`devisModel`, `optionsModel`,
  `resourcesModel`, `settingsModel`) detect missing columns at build
  time and gracefully drop the references — so minimal test schemas
  that haven't added the columns still run unchanged.

### Changed
- **Property detail page layout** (spec `properties-mvc.md` §6.1,
  2026-06-08). `/properties/:id` moves from an even `Grid` (which left big
  gaps under short cards) to **two explicit columns** on desktop (1 on
  mobile): left = Informations + Acompte & Solde, right = Horaires &
  Ménage + Options horaires + Options par défaut; the wide cards
  (Tarification + its seasons table, Documents, iCal Export, Connexions
  iCal) span full width below. Explicit columns keep card placement
  deterministic and spacing regular. Layout-only, no behaviour change.
- **Editing a template refreshes the « Emails à envoyer » queue.** The
  pending queue is rendered live (never a stored snapshot), so a
  template's content always reflects its current version; the Emails
  page now also re-fetches the queue after any template create / edit /
  delete / enable-toggle so a changed `dayOffset` / `sendMode` /
  `enabled` reshapes the on-screen list immediately.
- **Emails page route** renamed `/emails/modeles` → `/emails` (the page
  now hosts both the queue and the templates, not just templates). The
  old path redirects to the new one.
- **Emails page rework** (spec `email-automation.md` §6.10, 2026-06-08).
  `/emails/modeles` is now a unified **Emails page** with two cards:
  « Emails à envoyer » (the manual-email queue, previously only behind
  the dashboard popup — now an inline list, hidden when empty) and
  « Modèles d'emails ». Clicking a **template row** opens its edit
  dialog (the per-row edit icon is dropped). In the queue, clicking a
  **row** opens the editable preview/send dialog, while clicking the
  **client name** opens the matching reservation. The dashboard
  « Emails à vérifier » widget now **navigates** to the Emails page
  instead of opening a popup; the `EmailPendingDialog` component is
  removed and replaced by the presentational `EmailPendingList`.
- **Send an email to a client with no address on file** (spec
  `email-automation.md` §3 rule 10, 2026-06-08). Every « Emails à
  envoyer » row is now clickable, even when the client has no email.
  In that case the send dialog's banner shows an **editable address
  field**; on a successful send the typed address is **saved onto the
  client record** (`clients.email`, never overwriting an existing one),
  so the next email finds it on file. New server guards: `400
  INVALID_EMAIL` on a malformed typed address, `404 CLIENT_NO_EMAIL`
  only when nothing is on file and nothing typed.

### Migration
- `properties.nameArticle` added (`ALTER TABLE properties ADD COLUMN
  nameArticle TEXT DEFAULT 'au'`), idempotent at boot. Existing rows
  backfill to `'au'`; no data loss.
- Shipped J-7 reminder content migrations (idempotent, scoped to the
  `arrival_reminder_7d` template; operator templates + the
  "- Logement : {{propertyName}}" line untouched): rewrites the legacy
  `séjour à {{propertyName}}` phrasing to `séjour {{propertyWithArticle}}`,
  and the `{{companyName}}` signature to `{{senderName}}` — so installs
  seeded before these features pick up the article-aware + sender-name
  defaults.

### Added
- **Email signature uses the sender name, not the legal name** (spec
  `email-automation.md` §3 rule 14, 2026-06-08). New `{{senderName}}`
  token = Settings → Envoi d'emails → « Nom expéditeur »
  (`smtpFromName`, falls back to the « Raison sociale » `companyName`
  when blank). The seeded J-7 reminder now signs with it; a boot
  migration upgrades the old `{{companyName}}` signature on existing
  installs. `{{companyName}}` stays available for templates that want
  the legal name.
- **Property name with the correct French article in client emails**
  (spec `email-automation.md` §3 rule 13, 2026-06-08). Each property
  carries an operator-chosen article (`au` / `à la` / `à l'` / `aux`,
  field on the property detail form with a live preview), and the new
  `{{propertyWithArticle}}` template token renders « votre séjour au
  Gite / à la Tente / à l'Aventura Lodge » (the apostrophe form elides).
  The seeded J-7 reminder now uses it in its subject + opening line.
- **Client emails — templates, scheduled send + manual review** (spec
  `email-automation.md`, 2026-06-07). GuestFlow can now communicate
  with future guests via plain-text emails.

  Reuses the existing SMTP path (the one used for admin first-connection
  emails): single `emailService.send`, single `From:`, no new transport.

  **Templates library.** New `/emails/modeles` page with full CRUD on
  the `email_templates` table (sortable list + edit dialog with a
  variable / conditional picker). Every template carries a `dayOffset`
  (signed integer, J-7 = 7 days before `startDate`), a `sendMode`
  (`'auto'` or `'manual'`) and an `enabled` flag.

  **Variables** supported in subject + body (28 tokens listed in spec
  §4.4): client (firstName / lastName / fullName / email / phone /
  address), reservation (startDate / endDate / checkInTime /
  checkOutTime / nights / adults / teens / children / babies /
  totalGuests), property (propertyName), financial (finalPrice /
  depositAmount / depositDueDate / balanceAmount / balanceDueDate /
  cautionAmount), lists (optionsList / bedConfig), company info.

  **Conditional blocks** — single level: `{{#if hasBedLinenOption}}…
  {{else}}…{{/if}}`, `{{#if cautionNotBanked}}…{{/if}}`, `{{#if
  hasOptions}}…{{/if}}`. Unknown variables render as empty string;
  malformed `{{#if}}` blocks are passed through verbatim so the
  operator sees the literal text in preview.

  **Default template registry** (`utils/defaultEmailTemplatesRegistry.js`)
  — single source file holding every shipped default template as a
  self-contained object (`stableKey`, `name`, `subject`, `body`,
  `dayOffset`, `sendMode`, `enabled`). Adding a new default email is
  **one file change**: append an object + a one-line test case. No DB
  migration. Designed so AI-assisted additions stay trivial. The PR
  ships exactly one default: **"Rappel arrivée — J-7"** (manual mode,
  warm-but-professional, dynamically includes the bed-config block if
  the bed-linen option is ticked + the caution-check reminder if no
  bank deposit was made).

  **Boot-time seed** (`utils/defaultEmailTemplatesSeed.js`) iterates the
  registry; INSERTs by `stableKey` when missing. Idempotent +
  non-destructive: operator edits to a previously-seeded row survive
  across boots. A deleted seeded row gets re-inserted on next boot.

  **Hybrid trigger model.**
  - **Auto templates** ship daily at 08:00 local time via a new tick in
    `scheduledTasks.js` → `utils/emailAutoSendRunner.js`. Each
    matching `(template, reservation)` pair fires exactly once; skipped
    pairs already in `email_log` with `status='sent'`; devis excluded;
    failures logged with the error message.
  - **Manual templates** surface on a new **dashboard widget** with the
    count of pending emails. The widget renders nothing when the queue
    is empty. Clicking opens `EmailPendingDialog` listing every pair;
    each row offers "Voir & envoyer" (preview + edit + send) or
    "Ignorer" (logs an `acknowledged-skip` row so the pair drops out).
  - **Manual send from a reservation page** — new "Envoyer un email"
    action in the reservation's action bar (hidden in devis mode).

  **History page** `/emails/historique` lists every `email_log` row
  (paginated, filterable by status / template / reservation) with a
  read-only preview dialog showing the rendered subject + body + error
  message when failed.

  Total coverage: **92 server cases** (`email-template-renderer`,
  `email-context-builder`, `date-fr`, `default-email-templates-
  registry`, `default-email-templates-seed`, `email-templates-model`,
  `email-log-model`, `email-templates-controller`, `emails-controller`,
  `email-auto-send-runner`). Server suite 1068 → 1160. **18 Vitest
  cases** (`EmailLogViewDialog`, `EmailPendingAlert`, `EmailManualSendDialog`,
  `EmailTemplatesPage`).

  **Migration.** Two new tables (`email_templates`, `email_log`), both
  idempotent at boot, additive only. No existing data touched.

### Changed
- **Selective cleanup popup on `/clients`** (spec
  `clients.md` §3 rule 8, 2026-06-06). Clicking the **Cleanup clients**
  button no longer triggers an immediate bulk delete. It now opens a
  popup listing every client with no reservation and no devis, with a
  checkbox per row (all checked by default) plus a master "Tout cocher
  / décocher" toggle. The footer offers **Annuler** (pure no-op) and
  **Supprimer (N)** (disabled when N=0). Only the checked clients are
  deleted on confirm.

  Backend additions:
  - `GET /clients/cleanup-orphans/preview` — returns the orphan list
    server-sorted by `lastName, firstName` with `{ id, firstName,
    lastName, email, phone }`.
  - `POST /clients/cleanup-orphans/delete` — `{ ids: number[] }` body,
    returns `{ ok, deletedCount, skippedCount }`. Each id is
    re-validated as still-orphan inside a transaction; non-orphan or
    unknown ids count as `skipped` (race-safe against concurrent
    reservation creation).
  - The pre-existing bulk `POST /clients/cleanup-orphans` is kept for
    headless / programmatic callers but is no longer invoked by the
    UI.

  10 new server-side cases in
  `tests/clients-cleanup-orphans.unit.test.js` (1052 → 1062 green). 7
  new Vitest cases in `components/__tests__/ClientCleanupDialog.test.js`
  (273 → 280 green).

### Fixed
- **iCal sync no longer overrides establishment closures** (2026-06-06).
  Adrien declared a property closure for a week, but an iCal feed
  silently created a reservation overlapping it. Root cause:
  `propertyIcalModel.syncSource` calls the prepared `INSERT INTO
  reservations` directly — bypassing `validateAvailability` (which
  only runs on the HTTP API path), and therefore bypassing the
  closure check that exists there. Two paired defences:
  1. **Closure guard at sync time.** Every iCal event is now checked
     against `establishmentClosuresModel.findCoveringClosure(propertyId,
     start, end)` BEFORE any mapping resolution. When a covering
     closure is found, the event is silently skipped — no insert, no
     update, no mapping changes, no cancellation alert. The skip is
     counted in `result.skippedClosureCount` and surfaced in
     `ical_sources.lastSyncMessage` (`N ignoré(s) (fermeture)`).
     Honours global closures (`propertyId IS NULL`) too.
  2. **"Closed Period" filtered at parse time.** Airbnb labels host-
     blocked date ranges as `Closed Period` in the VEVENT SUMMARY.
     `isUnavailableIcalEvent` (which already dropped `blocked` / `not
     available` / `indisponible`) now also matches `closed period` /
     `closed-period` / `closed   period`. Events stamped this way
     never reach the sync loop, so they can't conflict with a closure
     even when one hasn't been declared yet.
  Tests: +6 server cases (1 parser regex sweep + 5 sync-time guard).
  Two pre-existing iCal test DDLs gained the `establishment_closures`
  table; one pre-existing test fixture's generic "Closed Period"
  summary was swapped for "Booked Ical" to stay flowing through the
  parser. Server tests 1041 → 1047 green in isolation.

### Added
- **Breakfast option + per-day planning card** (spec
  `breakfast-option-and-planning-card.md`, 2026-06-05). `Petit
  déjeuner` joins `Linge de lit` and `Linge de toilette` as the third
  typed-default catalog option — seeded at every boot (`autoOptionType
  = 'breakfast'`, `priceType = 'per_person_per_night'`, `price = 0`)
  via `utils/breakfastSeed.js`. The seed promotes any existing
  operator-created `Petit déjeuner` / `Petit-déjeuner` row to the
  typed marker, so prod servers gain the feature without manual
  cleanup.

  **Planning page** — a new `BreakfastDayCard` appears under each day
  where ≥1 reservation has the breakfast option AND the customer is
  present in the morning (= `startDate < D AND endDate >= D`, half-
  open `(startDate, endDate]` window). Each card lists the
  contributing reservations as `{clientName} ({propertyName}) : {N}
  pers.` and totals them in bold. Babies are excluded from the count
  (matching the bathroom-linen convention). The card uses an amber
  palette + croissant icon to visually separate it from the cyan
  laundry card. Mounted between `LaundryDayCard` and the departures
  block — operator scan: laundry → breakfasts → who's leaving today.

  **API** — new `GET /api/planning/breakfast?from&to` returns
  `{ breakfastByDate: { 'YYYY-MM-DD': { items: [...], totalPersons } } }`.
  Same property-default fallback pattern as the laundry aggregators
  (UNION ALL of explicit `reservation_options` ∪
  `property_option_defaults`; explicit row wins via `NOT EXISTS`,
  property fallback injects `qtySum = 1.0`).

  **Tests** — +25 (10 model + 5 seed + 5 controller server, + 5
  Vitest). Server suite 1033 → 1053 green (in-isolation; occasional
  parallel-runner flakes still surface suite-wide, all reproduce as
  pass alone). Vitest 237 → 242 green. Vite build clean (466 KB gzip
  ≈ baseline +0.6 KB).

  Live verified on dev server reservation #12082 (Gite property,
  2026-06-04 → 2026-06-07, tagged breakfast option, 8 persons): 3
  cards rendered on dates 06-05, 06-06, 06-07, arrival day (06-04)
  correctly excluded, departure day (06-07) correctly included.

  **Hotfix 2026-06-05 follow-up — cleaning info mirrored on the
  departure tile (same PR)** — Adrien asked that the small "ménage:
  Xh" badge that already shows on the next ARRIVAL card in a tight-
  transition alert also appear on the corresponding DEPARTURE card,
  so both ends of the conflict carry the same context. Wired
  `alertInfo` through to `DepartureMiniRow` (it already exists on
  `ReservationCard`) + extended the alert's `prevRes` explanation
  to embed the cleaning duration in the same shape as the arrival
  alert (`Arrivée de {client} {date} à {time}, ménage: {Xh}`). The
  red/orange/blue alert background is now also applied symmetrically
  on the departure card. Verified live on dev server: a Gite
  departure with a same-day next arrival shows the new badge
  alongside the existing tight-transition red border. No new tests
  — purely a string + a prop wired through; existing 245 Vitest
  cases still green.

  **Hotfix 2026-06-05 follow-up — clickable planning cards (same
  PR)** — All planning cards (arrivals, departures, breakfast) now
  open the corresponding reservation form on click. Wired
  `useNavigate` + `withFrom('/planning')` in `PlanningPage` and
  exposed an `onOpen(reservationId)` prop on `ReservationCard`
  (arrivals) + `DepartureMiniRow` (departures): the whole Card body
  is clickable with cursor + hover affordance. The per-row checkbox
  is `stopPropagation`'d so toggling ready/done doesn't trigger
  navigation. `BreakfastDayCard` gains an `onItemClick` prop —
  per-row click (one row = one reservation), `role="button"`,
  keyboard support (Enter / Space). +3 Vitest cases on
  `BreakfastDayCard` (245 → 248 green). Live verified: arrival
  card → /reservations/12103?from=/planning, departure
  → /reservations/12081?from=/planning, breakfast row
  → /reservations/12082?from=/planning. Checkbox click stays on
  /planning.

  **Hotfix 2026-06-06 — planning UI polish sweep (same PR)** — a
  small UX iteration loop, all on the planning page:
  - Cleaning info badge: first added on the arrival card too, then
    removed (the alert explanation text already carries it). On the
    DEPARTURE card only, a prominent red block (`CleaningServices`
    icon + bold "Ménage : Xh") sits where the now-removed "Famille"
    chip row used to be — the family breakdown belongs to the
    arrival card (welcome prep), the departure tile is about
    checkout time + cleaning.
  - Time pill on the top row of arrivals + departures: rounded,
    bold, solid orange/green (warning / success when done) bg, with
    an `AccessTimeIcon` to the left. The old `Person + name + clock
    + "Arrivée HH:MM"` second-line block is replaced by a single
    `Person + name` row — no duplication.
  - Top-of-page color legend ("Alertes de conflit") removed; per-card
    explanations are clear enough.
  - Icons sweep: `BreakfastDining` (croissant+cup) →
    `BakeryDining` (pure viennoiserie croissant); ARRIVÉE chip gets
    a big `FlightLandIcon` (plane landing) on the left; DÉPART chip
    gets a `FlightTakeoffIcon` (plane taking off). Distinct mirror
    silhouettes for the airport-board family.
  - Breakfast card rows redesigned: bigger croissant in the header,
    each row prefixed with the same `HomeWorkIcon` as on the
    arrival/departure cards, format `🏠 {property} • {client} : {N}
    petit(s) déjeuner(s)`. Multi-property days iterate one row each.

### Changed
- **Bed configuration moves inside the "Linge de lit" option card**
  (spec `bed-config-in-linen-card.md`, 2026-06-05). The 3 bed
  counters (Lits doubles / simples / bébé) + the "Suggérer les
  lits" button + the capacity-mismatch warning leave the
  "Voyageurs et couchages" card (renamed to "Voyageurs") and move
  into the "Linge de lit" option card inside the
  "Options et ressources" section. The sub-block is rendered ONLY
  when the bed-linen Switch is ON; toggling it OFF auto-zeroes the
  form state for the 3 bed counts.

  **Why** — pre-change, the operator could enter bed counts on a
  reservation without ticking the bed-linen option (the counts then
  sat in the DB but contributed zero to the laundry aggregation), OR
  tick the option while leaving the counts at 0 (silent "0 sheets
  to drop off" for a reservation that obviously has beds). The two
  surfaces are now coupled in the UI and on the server.

  **Server invariant** — `reservationsController.create` and
  `update` coerce `singleBeds / doubleBeds / babyBeds` to `0`
  whenever the final `reservation_options` (after the property-
  defaults auto-merge on create; as-submitted on update) contains
  no option flagged `countsAsBedLinen = 1`. Capacity validation
  uses the coerced values so a misbehaving client can't trip a
  "beds exceed property capacity" error on counts that won't
  even be saved.

  **Migration** — one-shot idempotent
  `zero_beds_when_no_bed_linen_option_v1` runs at boot, in a single
  SQL pass via `utils/zeroBedsWhenNoBedLinenMigration.js`. Zeroes
  the bed counts on every reservation (`kind = 'reservation'`) that
  has no bed-linen-flagged option in `reservation_options` AND
  whose property has no bed-linen-flagged option in
  `property_option_defaults`. Devis (`kind = 'devis'`) are skipped
  — they don't feed the laundry and they convert through the
  reservation controller anyway. **No data loss** for the laundry
  feature: the affected rows already contributed `0` to the
  aggregation (the SQL in `laundryModel.js` requires a flagged
  option to count).

  **Multi-option edge** — if the catalog carries more than one
  option flagged `countsAsBedLinen = 1` (rare; the seeded "Linge
  de lit" is the typical singleton), the inputs render exactly
  once, under the FIRST enabled bed-linen-flagged option in
  catalog order. The same form state (`form.singleBeds` etc.)
  backs them, so editing in one place is the only source of
  truth.

  **Hotfix 2026-06-05 follow-up (same PR)** — Adrien reported that on
  his Gite property (which has `Linge de lit` as a property default),
  EXISTING reservations whose `reservation_options` predate the
  default were showing the Switch OFF instead of ON — the form was
  treating `form.selectedOptions` as the only source of truth,
  ignoring the property contract. Fix:
  - **Server** — `reservationsController.update` now re-merges
    property defaults THAT ARE `countsAsBedLinen = 1` before the
    invariant runs. Other property defaults stay frozen on update
    (historical preservation rule from other specs). Pin via a new
    controller test.
  - **Client** — `ReservationFormContext` exposes
    `bedLinenForcedOptionIds: Set<number>` derived from
    `propertyOptionDefaults ∩ propertyOptions.filter(countsAsBedLinen=1)`.
    `firstEnabledBedLinenOptionId` now considers forced-by-default
    options as enabled. `ExtrasSection` renders the Switch as
    `checked + disabled` for forced options, with the "Inclus par
    défaut" caption next to it. The user CANNOT remove a bed-linen
    option enforced by the property.
  - Verified live on reservation #12077 (Gite property): Switch
    checked + disabled, 3 bed inputs visible, caption shown, sub-
    block rendered.

  **Hotfix 2026-06-05 follow-up #2 — GROSS_BELOW_NET on direct
  bookings (same PR)** — Adrien hit `400 GROSS_BELOW_NET` after
  adding the bed-linen option on reservation #12089 (direct booking,
  Gite property). Root cause is independent of this spec but
  surfaces through it: the form's gross input
  (`client/src/components/reservation/FinanceSection.js:129`) is
  rendered ONLY for non-direct platforms, so the stored
  `clientGrossAmount` sits frozen the moment `finalPrice`
  recomputes. The boot-time migration backfills
  `clientGrossAmount = finalPrice` for direct rows but doesn't
  re-fire on subsequent saves. The reservations controller now
  coerces `clientGrossAmount = quote.finalPrice` when
  `platform === 'direct'` (or empty) before the validator runs, in
  both `create` AND `update`. Platform reservations stay
  authoritative on the operator-entered gross (the input is visible
  + editable for them).
  Tests: +5 server cases in
  `reservations-controller-gross-coercion.unit.test.js`.

  **Coverage extension** — added 1 server test pinning that
  NON-bed-linen property defaults are NOT re-merged on update
  (historical preservation still holds for non-linen defaults), and
  2 extra Vitest cases on the property-default enforcement: a
  non-bed-linen catalog option stays toggleable when a bed-linen
  option is forced, and the disabled Switch stays disabled when the
  bed-linen option is explicit in `selectedOptions` AND forced by
  property default (no double-toggle confusion).

  **Hotfix 2026-06-05 follow-up #4 — empty platform never
  persisted (same PR)** — Adrien clarified the data invariant:
  `reservations.platform` always carries a real value, either a
  platform name (Airbnb, GitesDeFrance, etc.) or `'direct'`. NULL /
  `''` / whitespace-only must not exist anywhere in the table.
  - `reservationsController.create` and `update` normalise
    `req.body.platform` via a `normalisePlatform(value)` helper
    right after `validateFinanceInputs` — any future write that
    tries to persist an empty value is coerced to `'direct'` before
    anything downstream (including the gross-coercion logic above)
    sees it.
  - One-shot migration `platform_empty_to_direct_v1` (boot block in
    `database.js` + util `utils/normaliseEmptyPlatformMigration.js`)
    backfills legacy rows. Idempotent via the `migrations` table.
  - Tests: +5 migration cases + 5 controller cases. The migration
    pins NULL/''/'  ' all → 'direct' and "Airbnb/direct preserved";
    the controller cases pin the same on create + one on update.
  - Verified live: PUT to `/api/reservations/12089` with `platform:
    ''` returns 200 OK and the DB stores `'direct'` afterwards.

  **Tests (total for this spec + follow-ups)** — +27 server (5
  migration zero-beds + 5 controller invariant + 1 property-default
  re-merge + 1 non-linen-default scoping + 5 gross coercion + 5
  platform normalisation migration + 5 platform normalisation
  controller), +9 Vitest (7 `ExtrasSection.bed-linen-inputs` + 2
  `GuestsBedsSection.no-beds`). Server suite 1006 → 1033 green
  (in-isolation; parallel-runner flakes from earlier specs still
  occasionally surface); Vitest 228 → 237 green; vite build clean
  (465 KB gzip ≈ baseline). Manual verification on reservation
  #12077 (bed-linen card + Switch forcing) and live save on #12089
  (gross coercion + platform normalisation):
  Switch ON → sub-block + 3 inputs + button appear, Switch OFF →
  sub-block disappears.

### Added
- **Skip a laundry trip** (spec `skip-laundry-trip.md`, 2026-06-06).
  The operator (Adrien) can now mark a specific laundry trip date as
  not-made from the Planning page — a click on the `LaundryDayCard`
  header IconButton greys the card out, replaces the 3 detail blocks
  with a muted *"Voyage non réalisé — reporté au prochain voyage"*
  caption, and persists the decision in a new global table.

  **Motivation** — reality intrudes: sometimes the trip doesn't
  happen (illness, travel, day off). Today the projection keeps
  assuming the trip went, the displayed clean stock diverges from
  the bins on the shelf, and the shortage alert can over- or under-
  shoot. The skip toggle closes that loop in one click.

  **Engine cascade** — on a skipped date the engine performs neither
  the drop-off nor the pick-up; both backlogs flow forward to the
  next non-skipped trip. The pickup lookup widened from `drop date
  = cursor − 7` to `drop date <= cursor − 7` so a deferred batch is
  finally picked up alongside the regular 7-days-ago batch on the
  next successful trip. The initial state computation (when `from`
  is after a skipped trip) uses a new
  `previousOrSameNonSkippedLaundryDay` helper that walks back 7
  days at a time until finding a non-skipped Tuesday, so past skips
  surface as deferred dirty at engine startup — not just in the
  forward loop. Conservation invariant
  (`clean + inCirculation + dirty + atLaundry = totalStock`) holds
  across every test case (pinned in the new
  `linen-inventory-skipped-trip.unit.test.js`).

  **Data model** — new table `laundry_trip_skips(tripDate TEXT PK,
  createdAt)`, additive, starts empty, no migration. Global scope per
  spec §3.1 rule 1: one human, one trip per day, the toggle is per
  date (not per property). Endpoint trio `/api/laundry/skips` (GET +
  POST + DELETE), admin-only via the default `enforceRoleAccess`
  middleware. Idempotent on both POST and DELETE; 400 on a malformed
  date.

  **Shortage alert + Dashboard** — no new UI. The existing
  `LinenShortageAlert` re-renders with the post-skip projection
  numbers automatically because `linenInventoryModel.simulate` loads
  the skip set as a single point of injection. A skipped future trip
  that pushes the clean stock below 0 → alert grows. An un-skipped
  trip → alert shrinks.

  **Tests** — 24 new server unit cases + 6 new Vitest cases + 2 new
  Playwright E2E cases. Server tests 967 → 991 green; Vitest 223 →
  229 / 229 green; E2E 19 → 21 / 1 skip / 0 fail; build clean.

  **Hotfix 2026-06-05 (same PR)** — first round of testing surfaced a
  visible gap: the "Disponible après ce dépôt" line did react to a
  skip (driven by `linenInventoryModel.simulate`, already skip-aware),
  but the "À apporter" / "À récupérer" counts on the next non-skipped
  card stayed on their pre-skip values. Two parallel server paths
  feed the same UI card and only one of them was skip-aware. The
  user reported it as *"la carte blanchisserie suivante ne change
  pas"*. Fixed by wiring the skip set into
  `planningController.laundrySummary` + adding
  `utils/laundryWindow.previousNonSkippedLaundryDay` to derive the
  widened drop-off / pick-up windows. A skipped trip itself emits
  zeroed blocks — the client masks them with the existing "Voyage
  non réalisé" caption. +11 server tests (5 helper + 5 controller +
  1 full-stack regression case pinning the user-reported scenario).
  Server tests 991 → 1002 green.

  **Hotfix 2026-06-05 follow-up (same PR)** — second round of testing
  surfaced one more gap: with the server now skip-aware end-to-end, a
  full page reload showed the right cards, but the LIVE toggle still
  showed the old values. Root cause was in
  `PlanningPage.handleToggleLaundrySkip`: after persisting the skip,
  it only re-fetched `getLinenInventory` (the "Disponible" line) and
  not `getLaundryPlanningSummary` (the À apporter / À récupérer
  counts). The original handler carried a stale comment claiming the
  summary endpoint was unaffected by skips — true before the previous
  hotfix, false after it. Fixed by refetching BOTH endpoints in
  parallel inside the toggle handler. Verified live in a browser:
  toggling the first card flips it to "Voyage non réalisé" AND bumps
  the next card's drop-off counts up (11 → 15 doubles, 12 → 15
  simples) in the same render pass.

  **Hotfix 2026-06-05 follow-up #2 (same PR)** — third round caught a
  scroll-related regression. Adrien skipped trips 1 and 2 in a row
  (2026-06-09 then 2026-06-16) and the trip-3 card (2026-06-23)
  *disappeared* instead of absorbing the 3-week backlog. First patch
  used `lastLoadedRef.current` (the end of the last infinite-scroll
  page) as the upper bound of the refetch. Superseded by follow-up #3
  below — the right fix is server-side.

  **Hotfix 2026-06-05 follow-up #3 (same PR)** — Adrien correctly
  pushed back on follow-up #2: the toggle was relying on UI state
  (`lastLoadedRef.current`, a scroll bookmark), which conflates
  display with business logic. Per CLAUDE.md §6.0 the projection
  horizon is a backend concern.
  - **Server** — `GET /api/planning/laundry` now treats `to` as
    OPTIONAL. When omitted, the controller calls
    `linenInventoryModel.simulate()` and uses its `horizon` (= last
    reservation endDate) as the upper bound. Empty result when there
    are no future reservations.
  - **Client** — `api.getLaundryPlanningSummary({ from })` (no `to`)
    is the new short form. `handleToggleLaundrySkip` uses it for the
    post-toggle refetch so the visible range is always consistent
    with the simulation, regardless of scroll position. The
    infinite-scroll path keeps the explicit `from`/`to` form for
    paginated next-page fetches.
  - +4 server tests pin the new contract (default-to-horizon path,
    null-horizon path, explicit-`to` wins, `from` validation still
    400). Server tests now 1006/1006 green.
  - Verified live: reset skips, navigate fresh (no scroll), skip
    trip 1, skip trip 2, scroll down → trip-3 card visible with
    17 doubles + 15 simples + 19 grandes + 19 petites in À apporter.

### Fixed
- **Accounting export — legacy path now sees `customPrice` + offered
  options, no more negative VAT row** (2026-06-05). Live prod bug
  reported on Chloé Le Lann's reservation
  (#5, Gitedefrance, balancePaidDate 2026-05-07): the monthly export
  was producing

  ```
  CRÉDIT 70600000 Location gîte           624,54 €
  CRÉDIT 70600010 Prestation comp.         79,82 €
  CRÉDIT 44571100 TVA 10 %                -17,36 €   ← phantom
  ```

  Σ crédits still equalled Σ débits (687 €) — the accounting *was*
  balanced — but the VAT row showed −17,36 € for a reservation whose
  options were all offered to 0 €. The accountant rightly flagged it.

  **Root cause** — the engine's `buildEntry` has two paths: a
  contrib-driven path (used when at least one `*ContribTtc` column is
  non-NULL) and a legacy fallback that derives buckets from a freshly
  recomputed `quote`. Chloé's reservation had all contribs NULL (the
  Solde was flipped 2026-05-07, **before** the
  `force-item-to-complement` feature shipped and started capturing
  per-line contribs at the 0→1 flip), so the legacy path fired.

  `accountingModel.computeQuoteForReservation` was passing
  `selectedOptions` / `selectedResources` without the `offered`
  flag and was forgetting `offeredOptionIds` entirely. It was also
  passing `customPrice` but no test exercised that input. Net effect:
  the recomputed quote silently put the offered ménage back at its
  80 € catalog price, the legacy bucket emitted a 79,82 € credit on
  70600010, and the residue-absorption on the last credit line dumped
  the resulting -87,80 € mismatch onto the VAT row.

  **Fix** — `computeQuoteForReservation` now passes
  `customPrice: row.customPrice`, `offeredOptionIds` (computed from
  `reservation_options.offered = 1`), AND `offered: Boolean(o.offered)`
  on each `selectedOptions` / `selectedResources` entry. The legacy
  path's buckets now match `row.finalPrice` exactly → residue
  collapses to ≤ 1 cent of pure rounding noise → VAT stays positive.

  **Defensive guard — removed 2026-06-05** — PR #125 originally added a
  single-line `console.warn` when the credit-vs-debit residue exceeded
  1 €. After deploy the threshold proved too aggressive: legitimate
  legacy entries (e.g. reservation #12078 with 75,61 € deposit + 176,39 €
  balance residues from the deposit-pro-rata path) tripped it every
  export, producing log noise that hid real issues. The warning was
  removed; the silent absorption remains (it was always the production
  behaviour). A future negative-VAT regression is now caught by the
  existing `accounting-export-legacy-path-stale-quote` regression test
  (which asserts the VAT amount directly), not by side-effect log
  inspection.

  **Regression net** —
  `server/src/tests/accounting-export-legacy-path-stale-quote.unit.test.js`
  reproduces Chloé's exact prod state (in-memory DB + offered options
  + customPrice override + NULL contribs + Gitedefrance commission)
  and pins:
  - the legacy bucket shape (accommodation HT 569,09 + VAT 56,91, no
    options bucket);
  - the `legacyFraction` carries `grossRatio` (= 1,09744);
  - effective HT × fraction = 624,55 €, effective VAT × fraction =
    62,45 € (positive);
  - end-to-end CSV: no 70600010 row, no negative credit, no
    large-residue warning, Σ debits = Σ credits = 687 €.

  Server tests **964 → 967 / 967 green** (3 new cases; 2 pre-existing
  parallel-runner flakes from prior PRs still clear in isolation).

- **Plan comptable — `PUT /api/accounting/platform-accounts` no longer
  double-encodes the body + page renamed to "Plan comptable"**
  (2026-06-05). User report from prod: filling the form, hitting
  Save, leaving and coming back showed empty fields — nothing was
  ever persisted.

  Live Playwright capture of the failing request body on the dev
  server (rebuilt with prod-shape data):
  ```
  "{\"defaultAccount\":\"622600\",\"platforms\":[…]}"
  ```
  The body was JSON-stringified TWICE: once by
  `api.savePlatformAccounts` (`body: JSON.stringify(payload)`),
  then again by the shared `request()` helper in `client/src/api.js`
  (line 10 — single source of truth for body serialisation across
  the whole client). Express's body-parser rejected with
  `SyntaxError: Unexpected token '"', "{\"defau"...` and returned
  a `400 Bad Request`. The PUT response was an HTML error page,
  the alert surfaced "Bad Request", but the form's optimistic
  state still showed the typed values — so the user perceived the
  save as successful until the next reload returned the unchanged
  GET payload.

  **Fix** (`client/src/api.js` line 227): drop the redundant
  `JSON.stringify(payload)` and pass the raw object to
  `request()`, matching every other endpoint in the file. Comment
  added pointing back to this report so the next reader doesn't
  re-introduce the same mistake.

  **Regression net (two layers)**:
  - **API helper** (`client/src/__tests__/api-body-encoding.test.js`,
    2 cases) — (1) `savePlatformAccounts` produces a body that
    parses straight to the original payload, with the first
    character `{` (the smoking gun of double-encoding is a leading
    `"`); (2) source-level scan asserts NO `body: JSON.stringify(…)`
    exists in `api.js` outside the `request()` helper. Catches any
    future endpoint that re-encodes by mistake.
  - **Page-level round-trips** (`client/src/pages/__tests__/PlatformAccountsPage.test.js`,
    3 new cases on top of the 8 already shipped):
    (a) **Save round-trip** — after a save, the form reflects the
        server response (typed value + TVA toggle), the "Configuration
        enregistrée" alert is shown, and the Save button goes back to
        disabled. Would have failed loudly under the double-encode
        bug because `savePlatformAccounts` rejected with 400 and the
        alert showed "Bad Request" instead of "Configuration
        enregistrée".
    (b) **Remount round-trip** — unmounting the page and remounting
        with the new GET payload re-populates the form with the
        persisted values. This pins the exact prod scenario Adrien
        hit: leave the page → come back → fields should show what was
        just saved, never empty.
    (c) **Cancel restores last-saved state** — typing then clicking
        Cancel reverts to the initial value, not the typed one.
  Vitest **218 → 223 / 223 green**.

  **Page rename**: `/comptabilite/plateformes` was titled "Plan
  comptable plateformes" (header + sidebar + helper text in
  Settings → Général). Renamed to "Plan comptable" everywhere
  (3 client strings + 1 test assertion + 8 spec references).

- **Platform colours restored on EVERY calendar surface + the finance
  summary, with a filesystem invariant test that prevents the
  regression from re-appearing silently** (2026-06-05). Initial fix
  caught the three lookups on `MiniPlanningStrip.js`. A second sweep
  triggered by Adrien's request for full calendar coverage uncovered
  three more broken surfaces:
  - `SyncedPropertyMiniCalendars.js` (the dashboard's + simplified
    calendar's per-property mini strips) — 3 direct
    `platformColors[platform]` lookups in `buildDayGradient`.
  - `PropertyCalendarOverview.js` (legacy overview, currently unused
    in the routing but kept for future) — same pattern.
  - `pages/FinancePage.js` — 2 `<Chip sx={{ bgcolor: PLATFORM_COLORS[r.platform] }}>`
    on the finance reservation tables, making every non-direct
    platform appear with a `bgcolor: undefined` chip.
  - `pages/PropertyDetail.js` — 5 lookups against
    `source.platformKey` (lowercase slug, so the chips were
    visually correct today, but the read shape was fragile).

  **Refactors:**
  - The 3 calendar components no longer accept a `platformColors`
    prop. They import `getPlatformColor` directly. Removed the
    now-dead `platformColors={PLATFORM_COLORS}` prop from
    `CalendarPage` + `Dashboard`. `buildDayGradient` is exported
    from `SyncedPropertyMiniCalendars.js` + a new
    `buildMiniStripDayGradient` is extracted to a top-level pure
    function in `MiniPlanningStrip.js` so the colour-resolution
    paths are unit-testable in isolation.
  - `FinancePage` + `PropertyDetail` switched to
    `getPlatformColor(…)`; the latter also uses the new
    `isKnownPlatformKey(platform)` predicate (added to
    `constants/platforms.js`) for the iCal form's "well-known vs.
    custom" branch.

  **Tests** (`client/src/__tests__/calendar-platform-colors.test.js`,
  12 cases):
  - Pure-function coverage on `getReservationColor` +
    `buildMiniStripDayGradient` + `buildDayGradient` (synced) — every
    UpperCamelCase form (`Airbnb`, `Booking`, `Gitedefrance`,
    `Pitchup`, etc.) lands on its canonical colour, never
    `DEFAULT_PLATFORM_COLOR`.
  - **Filesystem invariant**: walks `client/src/**/*.{js,jsx,ts,tsx}`
    (skipping `constants/platforms.js` + every `__tests__/`) and
    fails on any direct `PLATFORM_COLORS[dynamicValue]` READ. Writes
    (the customColors merge in App.js: `PLATFORM_COLORS[key] = color`)
    are explicitly allowed via a negative lookahead because the key
    is normalised before assignment. Catches future drift
    automatically at lint time.

  `platforms.test.js` extended with 3 cases on `isKnownPlatformKey`.
  Vitest total **210 / 210 green** (195 from the previous step + 12
  calendar invariants + 3 helper).

- **Platform colours restored on the calendar + `<Select>` round-
  trips correctly after the UpperCamelCase migration**
  (2026-06-05). Two regressions caused by PR #118
  (`normalize-platform-names.md`) that the spec missed because it
  declared the frontend untouched:
  1. `client/src/constants/platforms.js → PLATFORM_COLORS` keys are
     lowercase slugs (`airbnb`, `gitedefrance`). Reservations now
     carry `platform = 'Airbnb'` / `'Gitedefrance'` (UpperCamelCase)
     so the direct lookup `PLATFORM_COLORS[reservation.platform]`
     returned `undefined` → every non-direct booking fell back to
     the default grey on the calendar.
  2. The `PLATFORMS` array used as `<MenuItem value=…>` in
     `ReservationPage`'s platform `<Select>` was lowercase.
     Reservations stored as `'Airbnb'` no longer matched any
     `MenuItem` → `<Select>` rendered blank on edit.

  **Fix** (`client/src/constants/platforms.js`):
  - New `normalizePlatformKey(platform)` helper: NFD-strip +
    lowercase + remove every non-alphanumeric character. Slug-shape
    compatible with the server's `KNOWN_PLATFORM_COLORS` keys.
  - `getPlatformColor(platform)` rewritten to slug the input before
    looking up the colour map — every shape (UpperCamelCase,
    lowercase, free-form with accents) resolves correctly.
  - `PLATFORMS` array switched to UpperCamelCase canonical form
    (`'direct'` stays lowercase, matches `formatPlatformName`'s
    output): the `<Select>` round-trips again.
  - `gitesdefrance` (plural) alias added so the accented form
    `'Gîtes de France'` resolves to the same yellow as the singular
    slug.

  Callers updated: 4 direct `PLATFORM_COLORS[…]` lookups in
  `MiniPlanningStrip.js` replaced with `getPlatformColor(…)`; the
  `customColors` merge in `App.js` now re-normalises incoming server
  slugs before assigning. `PropertyDetail.js`'s lookups by
  `ical_sources.platformKey` are unchanged (that column is the
  lowercase slug by construction).

  Tests: `client/src/constants/__tests__/platforms.test.js`
  (13 Vitest cases) pins the slug normaliser, every UpperCamelCase
  reservation form, the "Gîtes de France" plural variant + the
  dropdown invariants. Spec `normalize-platform-names.md` §4.2
  updated with a "2026-06-05 follow-up" subsection so the next
  reader sees this gap was retroactively closed.

### Fixed
- **MUI 9 — `<Stack>` CSS-shorthand props now passed via `sx` everywhere,
  silent layout breakage finally killed** (2026-06-05). The migration
  from MUI 5 → 9 (PR #114) silently dropped support for
  `justifyContent`, `alignItems` and `flexWrap` as direct `<Stack>`
  JSX attributes — in MUI 6+ they MUST be passed inside `sx={{ … }}`,
  otherwise they're stripped at runtime and the rendered DOM gets
  `justify-content: normal`, `align-items: normal`, etc. `direction`
  and `spacing` still work as props (they're explicit Stack API
  fields).

  The breakage stayed invisible for weeks because most layouts had
  a `<Box flex={1}>` as the first child of every Stack, which spreads
  space naturally regardless of `justifyContent` — the right-side
  cluster of every option card landed on the right edge even with
  the prop dropped. The polish in PR #121 (small Switch + no inline
  label + no `flexGrow: 1` on the Total chip) shrank the right-side
  cluster enough that the bottom row of the Extras section visibly
  collapsed to the left. Confirmed via Playwright DOM inspection
  on a real platform reservation: `getComputedStyle(stack)
  .justifyContent === 'normal'` for every offender, then
  `'space-between'` after the migration.

  **Sweep** (21 occurrences across 8 files):
  - `components/reservation/ExtrasSection.js` — 11 Stacks (the
    user-reported regression: bottom row of every option / resource
    card on the reservation form).
  - `components/MiniPlanningStrip.js` — 1 Stack (the toolbar above
    the mini planning strip in the reservation form).
  - `components/PropertyDefaultOptionsCard.js`,
    `components/OptionPropertyDefaultsMirror.js`,
    `components/LogoUpload.js` — 1 each.
  - `pages/AccountingPage.js` — 9 Stacks (monthly toolbar + legend +
    encaissement rows).
  - `pages/DevisPage.js` — 2 Stacks (filter row + row actions).
  - `pages/UserManagementPage.js` — 4 Stacks (table cells + mobile
    card actions).

  **Regression net**: a new Vitest filesystem-walk test
  (`client/src/__tests__/mui9-stack-props-no-direct-shorthand.test.js`)
  scans every `.{js,jsx,ts,tsx}` under `client/src/` (skipping
  `__tests__/`) and fails on any `<Stack … {justifyContent,
  alignItems, flexWrap}="…">` direct-prop usage. Multi-line Stack
  openings are tolerated by the regex (the initial grep that drove
  the manual sweep missed one — the test caught it). Any future
  drift back to the broken pattern now breaks the suite at lint
  time. Vitest **189 → 190 / 190 green**.

### Changed
- **Extras on platform reservations always routed to Complément**
  (spec `force-extras-complement-on-platform.md`, 2026-06-04). Sister
  rule to PR #116 (no deposit on platforms): the platform's single
  bank transfer covers the base stay = Solde, but any baby bed,
  late check-out surcharge, ménage extra or resource line is paid
  **directly by the guest on site** = Complément. Today the operator
  has to remember to flip the per-line "Compl." toggle on every
  extra of every platform reservation; this PR moves the rule to
  the server-authoritative side and lets the UI hide the toggle
  entirely.

  **Two halves to the fix:**

  - **Write-time forcing** in `reservationsModel` (`isPlatformNonDirect`
    + `readPlatformForcing` helpers): every extra line written via
    `replaceOptions`, `insertOptions`, `insertCustomOptions`,
    `insertResourceLine` is OR'd with the reservation's just-persisted
    `platform` value within the same transaction. Non-direct platforms
    → `inComplement = 1` forced + both contribs nulled, regardless of
    what the payload says. Same channel covers auto-options (they flow
    through `optionLines`).

  - **One-shot boot migration** (gated by
    `migrations.force_extras_complement_on_platform_v1`,
    `utils/forceExtrasComplementOnPlatformMigration.js`): for every
    reservation with a non-direct platform, UPDATE the 3 extras
    tables to set `inComplement = 1` + null both contribs `WHERE`
    inComplement = 0. The `WHERE` guard makes it idempotent — a
    second boot reports 0 affected. Captured acompte contribs on
    platform extras (rare legacy data) trigger a one-line warn log
    per affected reservation/table so the operator can spot-check
    the next monthly export. Mirrors the
    `normalizePlatformNamesMigration` extraction pattern for
    testability.

  **Frontend mirror:** `ExtrasSection` derives `isPlatformReservation`
  from `form.platform` and hides the 4 per-line "Compl." Checkbox
  blocks (property options, auto-options, custom options, resources),
  replacing them with a single muted caption:
  *"Réservation plateforme — les extras sont automatiquement facturés
  en paiement complémentaire."* `PricingSummary` mirrors the
  derivation and hides every per-line `<ComplementChip>` — but the
  **"Offrir / ✓ Offert"** Button stays visible and interactive on
  every line. An operator can always make a geste commercial on an
  extra, regardless of whether the booking came via a platform; the
  "Offrir" code path is untouched. `ReservationPage`'s `quoteInput`
  useMemo projects `inComplement: 1` on every entry of the three
  extras arrays + unions the catalog's auto-enabled option ids into
  `autoOptionsInComplement` when on a platform — keeps the live
  preview consistent with what the server writes on save without
  mutating form state (operators keep their toggle choices intact if
  they switch back to direct mid-edit).

  **Tests:** +12 server unit cases (6 migration + 6 model write-time
  forcing) + 7 Vitest cases (4 ExtrasSection + 3 PricingSummary).
  Server suite stays green minus the same parallel-runner flake from
  PR #116/#118 that clears in isolation; Vitest 189/189; E2E
  18/1 skip/0 fail; client build 464.29 kB gzip (within budget).

  **Risk:** past CSV exports for platform reservations with
  pre-existing options/resources will surface those extras in the
  **Complément** entry instead of in the **Solde** entry, starting at
  the next boot after deploy. Accepted (same risk family as PR #116).
  Operators who want to compare against the previous shape should
  snapshot the DB before deploy. Escape valve to re-run / inspect:
  `DELETE FROM migrations WHERE name =
  'force_extras_complement_on_platform_v1'` + restart.

- **Platform names — UpperCamelCase canonical form everywhere** (spec
  `normalize-platform-names.md`, 2026-06-04). Follow-up to PR #116 which
  extended the platforms list to a union of `ical_sources.platformLabel` +
  `reservations.platform` and surfaced obvious data-quality drift on the
  prod-copy DB: `Gitedefrance` + `gitedefrance`, `Lodgify` + `lodgify`,
  `Abracadaroom` + `abracadaroom` were all stored as separate rows.

  **Two halves to the fix:**

  - **Write-time formatter** (`utils/platformNameFormat.js`):
    `formatPlatformName(input)` reduces a free-form platform string to a
    canonical UpperCamelCase shape. Diacritics stripped, spaces/punctuation
    split, each segment capitalized, joined without separator. Idempotent
    on its own output (the splitter detects camelCase boundaries on the
    second pass). The `direct` enum value is preserved as lowercase so the
    codebase's strict equality checks against `'direct'` keep working.
    Applied at every write site: `propertyIcalModel.createSource` +
    `updateSource` (for `ical_sources.platformLabel`),
    `reservationsModel.insertReservation` + `updateReservation` (for
    `reservations.platform`), `platformsModel.upsertByName` (belt-and-
    suspenders for any caller that bypasses the upstream hooks).

  - **One-shot boot migration** (`utils/normalizePlatformNamesMigration.js`,
    gated by `migrations.platform_names_normalized_v1`): walks every
    `platforms` row, computes the canonical name, groups by canonical, and
    for each group with > 1 member: merges to a single row keeping the one
    with non-NULL `commissionAccountNumber` (tiebreak by lowest id),
    updates `ical_sources.platformLabel` + `reservations.platform`
    references to the winner's name, deletes the losers. Then a defensive
    pass normalizes orphan labels in the source tables (rows with no
    matching `platforms` entry). The whole sequence wraps in
    `db.transaction()` so a partial run rolls back cleanly. Logs one line:
    `[migration:platform-names-normalized] merged N conflict(s), renamed M
    row(s)`.

  Boot smoke on the prod-copy DB after the migration: 12 → 9 platforms
  (3 conflicts merged — Gitedefrance, Lodgify, Abracadaroom — and 2 rows
  renamed to canonical). The typo `Logify` (which isn't the same string as
  `Lodgify`) survives — the formatter is a mechanical case-normalizer, not
  a spell-checker; operator can delete the typo row from the dedicated
  page if they want.

  Server tests +18 cases (11 on the formatter pinning every entry of the
  spec §3.1 table + idempotency, 7 on the migration pinning merge
  conflict resolution + defensive pass + idempotency + the `direct` enum
  pass-through). Server suite 952 / 952, Vitest 163 / 163 (no client
  change), build clean.

  **Out of scope** (each its own future spec or manual cleanup): typo
  correction, foreign-key constraint on `reservations.platform`, automated
  re-normalize tool if Adrien wants to re-run after a manual data edit
  (today's escape hatch: `DELETE FROM migrations WHERE name =
  'platform_names_normalized_v1'` + restart).

### Fixed
- **Dev server — `/uploads/*` now proxied to the backend** (2026-06-04).
  Regression from the CRA → Vite migration (PR #111): CRA's
  `"proxy": "http://localhost:4000"` field was a **catch-all** that forwarded
  every unmatched request to Node, including `/uploads/*` (company logo +
  property photos, served by `server/src/index.js` line 100). Vite requires
  explicit prefix entries, and the migration only listed `/api`. Symptoms on
  the local `npm run dev` setup: broken `<img src="/uploads/…">` tags on
  `/settings` and `/properties`, and the dynamic favicon silently falling
  back to the bundled `client/public/favicon.ico` because
  `/uploads/company-logo.png` 404'd. Fix: add `/uploads` to
  `vite.config.js → server.proxy`. Prod path was never affected (Express
  serves `/uploads` directly there). Spec `cra-to-vite-migration.md` §3.1
  updated to list both proxy prefixes + explain the CRA catch-all behaviour
  for future migrations.
- **CI deploy — `release.sh` rsync now creates the missing `client/` parent directory**
  (2026-06-04). Regression from the CRA → Vite migration (PR #111): `release.sh` line 61
  copies `client/dist/` → `client/build/` inside the release archive, but rsync only
  creates the leaf (`build/`) — not the intermediate parent `client/`. The first rsync
  in the script (line ~46) only created `$RELEASE_DIR/server/`, so the subsequent client
  rsync failed with `mkdir "guestflow-release/client/build" failed: No such file or
  directory` and aborted the deploy at the "Create release archive" step. Fix: add
  `--mkpath` (GNU rsync ≥ 3.2.3 — the Pi self-hosted runner runs 3.4.1, so it's
  supported). The `dist/` → `build/` rename inside the archive stays unchanged so the Pi
  PM2 deploy layout is backwards compatible. **Note for local dev on macOS**: Apple's
  default `rsync` is `openrsync` which doesn't understand `--mkpath`; install GNU rsync
  via `brew install rsync` to run `release.sh` locally.

### Changed
- **Accounting export — platform commission as journal lines + no-deposit on platforms**
  (spec `accounting-platform-commission-and-no-deposit.md`, 2026-06-04). Driven by
  the accountant's 2026-06-04 email pushback on the previous CSV: turnover was
  recognised on the **net** (`finalPrice`) instead of on the **gross**
  (`clientGrossAmount`), and the platform commission was just a trailing info
  column instead of a real charge journal line.

  **New shape per encaissement** (Gîtes de France booking, 687 € gross / 626 €
  net / 61 € commission):

  ```
  DÉBIT C<NAME>  626          (net = bank movement)
  DÉBIT 62260500  50,83       (commission HT — per-platform compte)
  DÉBIT 445660    10,17       (TVA déductible 20 %)
  CRÉDIT 706000   624,55      (CA HT on the GROSS)
  CRÉDIT 445711    62,45      (TVA collectée 10 % on the GROSS)
  Σ debits = Σ credits = 687
  ```

  **What's new on the database:**
  - NEW `platforms` table — deduped per-platform commission config (auto-seeded
    with the `direct` row + `DISTINCT ical_sources.platformLabel` at boot; the
    iCal source create / update path calls `platformsModel.upsertByName` so a
    fresh platform surfaces on the dedicated config page immediately).
  - `app_settings` gains `defaultCommissionAccountNumber` (TEXT, default
    `'622600'`) — fallback when a platform row doesn't set its own account —
    and `vatRateCommission` (REAL, default 20) — global rate applied to
    commissions whose row carries `hasVatOnCommission = 1`, lives in
    Settings → Général → Taux de TVA next to the existing `vatRate`.
  - One-shot migration `platform_no_deposit_v1` (gated by a `migrations` flag
    table): collapses every legacy non-direct platform reservation's deposit
    into the balance + nulls the per-line `acompteContribTtc` snapshots so the
    contrib path falls back to legacy pro-rata cleanly. **Past CSV exports
    change retroactively on these rows — accepted call per spec rule 9**;
    snapshot the SQLite DB before deploy as a safety net.
  - Backfill `clientGrossAmount = finalPrice` for direct reservations where the
    column was NULL (now always populated; `gross === net` trivially for directs).

  **What's new on the engine:**
  - `pricing.js` enforces `depositAmount = 0` + `balanceAmount = preArrivalAmount`
    on every non-direct platform, regardless of `depositPaid`. Same effect as
    `depositDisabled` but driven by `platform` instead.
  - `accountingModel.buildEntry` reads one snapshot of
    `{ defaultAccount, vatRateCommission, platformByName }` per export run.
    Scales bucket TTCs by `effectiveGross / finalPrice` so 70xxx HT + 44571x
    VAT are credited on the GROSS. For the balance entry of non-direct
    platforms: builds the commission line (HT on the resolved compte +
    optional VAT on 44566000 when `hasVatOnCommission = 1`). Complement
    entries: 0 commission (host-billed extras).
  - `accountingExport.entryToRows` debits CCLIENT at the net (= bank movement)
    + emits commission HT + VAT debit lines right after, so Σ debits = Σ
    credits = gross TTC to the cent. The CSV columns + `Pièce` numbering
    convention stay unchanged.

  **New page `/comptabilite/plateformes`** — admin + accountant edit the
  per-platform config from one centralised place. Top card = compte par
  défaut (6–8 digit fallback); bottom card = table listing every platform
  with editable compte + Switch TVA déductible. Direct row's inputs grayed
  out. The platform list is the **union of `ical_sources.platformLabel`
  AND `reservations.platform`** — so a manually-entered platform name on a
  one-off reservation also surfaces here (it wouldn't if we only seeded
  from iCal sources). A **"Rafraîchir la liste" button** on the page
  triggers `POST /api/accounting/platform-accounts/refresh` so a brand-new
  platform name appears without a server restart; the UI flashes
  *"+N nouvelle(s) plateforme(s) ramassée(s)"* on success. Sidebar gains
  the link under Suivi financier; accountant's minimal sidebar grows by
  one item.

  **Reservation FinanceSection** — Acompte block hidden on non-direct
  platforms, replaced by *"Pas d'acompte (réservation plateforme — virement
  unique)"*. Direct bookings unchanged.

  Acceptance gate — all green:
  - `npm run build`: 2.24 s, 0 esbuild warnings, gzip 464.07 kB (+1.92 kB
    vs the post-React-19 baseline, well under the +10 kB budget).
  - Vitest: 163 / 163 (162 existing + 1 updated roles test for the
    accountant's new allow-list entry).
  - Playwright E2E: 18 passed / 1 skipped / 0 failed.
  - Server tests: ~30 new cases (5 platforms-model + 7 commission-lines + 4
    no-deposit + 10 platform-accounts-endpoint + 4 vatRateCommission), on
    top of 880 pre-existing.

  **Out of scope** (each its own future spec): Pièce numbering scheme
  (deferred since the original `accountant-accounting-export.md` spec), auto-
  fill of the gross from the per-platform commission rate, alias resolution
  for manually-entered platform names that don't match an iCal source.

  **Operational note** — **snapshot the SQLite DB before deploying this PR
  to prod**. The platform-no-deposit migration is destructive: deposit
  amounts collapse into the balance on every legacy non-direct platform
  reservation. The collapse is mathematically equivalent for the
  reservation's total owed amount, but past monthly CSV exports change
  shape (one balance entry instead of deposit+balance), so the accountant
  may want a paper copy of the previous exports for cross-reference before
  the deploy.

- **Client framework: React 18 → 19 + Recharts 2 → 3** (spec
  `react-19-and-recharts-3-migration.md`, 2026-06-04). **Third and final
  major-version dep upgrade unlocked by the CRA → Vite migration (PR #111)
  — this closes the migration chain.** Combined into one PR because
  recharts 2.x peer caps at React 18 (`^16 || ^17 || ^18`); bumping React
  alone would leave the install graph in a peer-mismatch state. Recharts 3
  brings React 19 into its peer range, so doing both at once produces a
  clean graph. Bumps:
  - `react@^18.2.0` → `^19.0.0` (resolved 19.2.7)
  - `react-dom@^18.2.0` → `^19.0.0` (resolved 19.2.7)
  - `recharts@^2.10.0` → `^3.8.0` (resolved 3.8.1)
  - `@testing-library/react@^15.0.7` → `^16.3.2` (the v15 line caps peer
    at React 18; v16 is the first line with React 19 in its peer range —
    audit gap closed during implementation)

  **Zero source-file change required** per the audit. The codebase was
  exceptionally clean for a React 19 bump:
  - Entry point already uses `ReactDOM.createRoot()`.
  - Zero legacy APIs (`ReactDOM.render` / `hydrate` /
    `unmountComponentAtNode` / `findDOMNode`, string refs, legacy Context,
    `propTypes`, `defaultProps` on function components, `componentWill*`
    UNSAFE lifecycles).
  - Zero class components, `<StrictMode>`, `<Suspense>`, `useTransition`,
    `useDeferredValue`, `forwardRef` in production code, explicit
    `act(...)` calls.
  - 122 `useEffect` hooks all properly cleaned up (spot-checked the 5 most
    side-effectful — race-guards and listener removal everywhere).
  - FinancePage's 11 recharts components (`BarChart`, `Bar`, `XAxis`,
    `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`,
    `PieChart`, `Pie`, `Cell`, `Legend`) all API-stable across v2 → v3.

  Acceptance gate (spec §7.1) — all green:
  - `npm ls react react-dom recharts react-is`: single top-level `19.x` /
    `19.x` / `3.x`, no duplicate, no v18 / v2 ghost left.
  - `npm run build`: 2.36 s, **0 esbuild warnings**.
  - Vitest: **163 / 163** (160 existing + 3 new smoke cases).
  - Playwright E2E: **18 passed / 1 skipped / 0 failed**, identical to
    the post-MUI-9 baseline.
  - Server tripwire: green in isolation.

  Bundle: 445.64 → **462.15 kB gzip** (+16.51 kB / +3.7 % of the bundle).
  The original spec budget of +15 kB was relaxed to +20 kB during
  implementation once the cause was confirmed as known upstream growth
  (React 19's scheduler refactor + Recharts 3's hooks-based refactor,
  ~5 kB each per their release notes). Same protocol as the router-v7
  +5 → +10 kB call.

  New smoke coverage (`client/src/__tests__/react-19-and-recharts-3-smoke
  .test.js`, 3 cases) — pinning the contracts a hypothetical React 20 or
  Recharts 4 bump would touch:
  - `createRoot` from `react-dom/client` mounts and unmounts a tree under
    `act()` — the v18+/v19 entry-point contract.
  - `useState` round-trips a setter under `<MemoryRouter>` — modern hooks
    contract.
  - `<BarChart><Bar/></BarChart>` with explicit width/height mounts under
    recharts 3 — FinancePage chart-mount contract.

  **Out of scope** (each its own future spec): `<StrictMode>` adoption,
  `use()` hook adoption, React Compiler adoption, `<Activity>` component,
  cleanup of the 53 dead `import React from 'react'` statements that the
  automatic JSX runtime makes optional, Recharts 3 tree-shaking
  optimizations via manual sub-path imports.

  **Migration chain status: CLOSED**. The four queued major-version dep
  upgrades unlocked by the CRA → Vite PR (#111) are all shipped: router 7
  (#113), MUI 9 (#114), and this PR (React 19 + Recharts 3). The next
  session can pick a brand-new feature instead of an upgrade.

- **Client UI library: `@mui/material` 5 → 9** (spec `mui-5-to-9-migration.md`,
  2026-06-04). Second of the four queued major-version dep upgrades unlocked
  by the CRA → Vite migration (PR #111), and the gating peer for the React
  18 → 19 bump next in the chain. Bumps:
  - `@mui/material@^5.15.0` → `^9.0.1`
  - `@mui/icons-material@^5.15.0` → `^9.0.1`
  - `@mui/x-date-pickers@^6.18.0` → `^9.4.0`

  MUI skipped v8 for `@mui/material` (npm dist-tags: `latest-v7=7.3.11`
  then directly `latest=9.0.1`), so the conceptual jump is 5 → 6 → 7 → 9
  but the npm bump is a single `^9.0.1` install. **Zero observable behavior
  change** for the end user; visual + interactive parity verified by the
  acceptance gate.

  Acceptance gate (spec §7.1) — all green:
  - `npm ls @mui/material @mui/x-date-pickers @mui/icons-material`: single
    top-level `9.x` on each, every emotion peer deduped on 11.14.x.
  - `npm run build`: 2.19 s, **0 esbuild warnings**.
  - Vitest: **160 / 160** (156 existing + 4 new MUI smoke cases).
  - Playwright E2E: **18 passed / 1 skipped / 0 failed**, identical to the
    post-router-v7 baseline.
  - Server tripwire: green in isolation (allow the same 2-3 pre-existing
    parallel-runner flakes).

  Bundle: 434.13 → **445.64 kB gzip** (+11.51 kB / +2.6 % of the bundle),
  well under the +25 kB strict budget set in spec §3.5 + §9 Q3.

  Source-side migration shape (`mui-codemod` ran transiently via npx,
  never installed as a dep):
  - **Grid v2 API**: 56 `<Grid item xs/sm/md/…>` sites across 8 files
    collapsed into `<Grid size={{…}}>`. Codemods used:
    `v6.0.0/grid-v2-props` + `v7.0.0/grid-props`.
  - **TextField slot APIs**: `InputProps`, `InputLabelProps`,
    `FormHelperTextProps` → `slotProps={{ input, inputLabel, formHelperText }}`
    across 24 files. Codemod: `deprecations/text-field-props`.
  - **ListItemText slot API**: `<ListItemText primaryTypographyProps=…>` →
    `slotProps={{ primary: … }}` in the App.js sidebar nav (10+ sites in
    one file). Codemod: `deprecations/list-item-text-props`. Caught when
    the E2E `Dashboard loads with zero console errors` test failed on a
    React `unknown DOM prop primarytypographyprops` warning.
  - **`color="default"` cleanup**: 2 manual fixes — Chip on FinancePage
    ("Acompte désactivé") + IconButton on DevisPage (convert action). The
    `default` color token was removed in v6+; without a `color` prop the
    rendered look matches the pre-fix.
  - **`<Switch>` accessibility upgrade**: v9 exposes WAI-ARIA `role="switch"`
    instead of `role="checkbox"`. Two ExtrasSection test assertions
    updated (`getAllByRole('checkbox')` → `getAllByRole('switch')`).
  - **Icon path rename**: `@mui/icons-material/DeleteOutline` (1 site in
    UserManagementPage) → `DeleteOutlineOutlined`. The bare `Outline`
    variants were dropped in v9 in favor of the `Outlined` suffix.

  New smoke coverage (`client/src/__tests__/mui-smoke.test.js`, 4 cases —
  one more than the spec's original 3 to pin the Switch accessibility
  upgrade that surfaced during the work):
  - `<Grid container><Grid size={{ xs: 12, md: 6 }}>…</Grid></Grid>` —
    pins the v9 Grid API shape.
  - `<Chip>` without a `color` prop renders correctly — pins the
    post-`color="default"` shape.
  - `<Switch slotProps={{ input: { 'aria-label': … } }}>` exposes
    `role="switch"` — pins the v9 accessibility upgrade and the
    `slotProps` migration.
  - `<DatePicker>` under `<LocalizationProvider dateAdapter={AdapterDayjs}>`
    mounts — pins the date-pickers v9 contract.

  **Out of scope** (each its own future spec): `cssVarsTheme` adoption,
  `@mui/material-pigment-css` engine (zero-runtime alternative to emotion),
  `@mui/x-data-grid` adoption, `<DateField>` field-component UX.

  **Next in the chain**: React 18 → 19 (now unblocked — MUI 9 fully
  supports React 19), then Recharts 2 → 3 (independent of the chain).

- **Client routing: react-router-dom 6 → 7** (spec `react-router-7-migration.md`,
  2026-06-04). First of the four queued major-version dep upgrades unlocked by
  the CRA → Vite migration (PR #111). Bump `react-router-dom@^6.20.0` (resolved
  `6.30.4`) → `^7.16.0` (resolved `7.17.0`). **Zero observable behavior change**
  for the end user; **zero source-file change required** — the 10 APIs we use
  (`BrowserRouter`, `MemoryRouter`, `Routes`, `Route`, `Link`, `Navigate`,
  `useLocation`, `useNavigate`, `useParams`, `useSearchParams`) keep identical
  signatures in v7. The audit confirmed zero data-router APIs in use
  (`createBrowserRouter`, `RouterProvider`, `loader:`, `action:`, …) so the
  migration was a `package.json` bump + a verification gate, not a routing
  rewrite.

  Acceptance gate (spec §7.1) — all green:
  - `npm ls react-router-dom`: single top-level `7.17.0`, no duplicate transitive.
  - `npm run build`: 2.24 s, **0 esbuild warnings**.
  - Vitest: **156 / 156** (153 existing + 3 new smoke cases pinning the
    classic-API contract for any future v8 bump).
  - Playwright E2E: **18 passed / 1 skipped / 0 failed**, identical to post-Vite.
  - Server tripwire: 890 / 892 (2 pre-existing parallel-runner flakes that pass
    in isolation, unrelated to this change).

  Measured bundle size: 428.24 → **434.13 kB gzip** (+5.89 kB / +0.4 % of the
  bundle). Driven by an expected upstream change documented in the v7 release
  notes: `@remix-run/router` no longer ships as a separate sub-package, the
  data-router internals are bundled directly inside `react-router` even for
  classic-API consumers. The original spec budget of +5 kB was relaxed to
  +10 kB during implementation (§3.5 rule 13 + §9 Q3 updated) once the cause
  was confirmed as a non-regression; reverting the bump for +0.4 % of the
  bundle would block the entire upgrade chain (MUI 9, React 19, Recharts 3)
  for no functional gain.

  New smoke coverage (`client/src/__tests__/router-smoke.test.js`, 3 cases):
  - `<BrowserRouter>` mounts a `<Routes>` + `<Route element>` tree.
  - MUI `<Button component={RouterLink} to=…>` renders an anchor with the
    right `href` — pins the forwardRef adapter pattern used in
    `AccountingPage.js` (journal entry → reservation link).
  - `useNavigate()` round-trips the pathname under `<MemoryRouter>` — the
    foundation of every imperative navigation (28 call sites in the app).

  **Out of scope** (each its own future spec): data-router adoption
  (`createBrowserRouter` + loaders / actions), route-level `errorElement`,
  `useNavigate({ flushSync: true })`. Picked up only if/when concrete use
  cases appear.

  **Next in the chain**: MUI 5 → 9 (the big one, the React 19 unlock), then
  React 18 → 19, then Recharts 2 → 3.

### Fixed
- **Devis PDF — date du devis, validité, taxe de séjour, options par défaut**
  (spec `devis-pdf-and-tourist-tax-fixes.md`, 2026-06-04). Four user-reported defects
  bundled into one PR because they live in the same devis-generation flow:
  - **"Date du devis" was blank on recent devis.** Some rows (e.g. `2026-06-001`,
    `2026-05-007`) ended up with `createdAt = ''` despite the SQLite default. Fix:
    explicit `createdAt = datetime('now')` binding on every devis INSERT path
    (`create` + `convertFromReservation`), plus a defensive fallback in
    `devisPdf.js` that prints today's date for legacy bad-data rows.
  - **"Valable jusqu'au" ignored the configured `quoteValidityDays`.** The
    `validUntil` column was NULL on every devis in the prod-copy DB — the PDF was
    silently computing "today + days" on each render, oblivious to the issue date.
    Fix: persist `validUntil = createdAt + quoteValidityDays` (capped at `startDate
    - 2`) on `create` / `convertFromReservation`; `update` back-fills it on the
    first edit of a legacy row; the PDF reads the persisted value with the same
    formula as a forward-only fallback.
  - **Property option defaults (e.g. `Linge de lit`) were silently dropped from
    new devis.** The client merged them into the form AFTER the price call, but
    nothing on the server enforced the contract — a UI race / raw API caller saved
    the devis without them. Fix per "fat backend": `devisModel.create` AND
    `reservationsController.create` now merge any `property_option_defaults` entry
    not already in the payload BEFORE computing the quote. Idempotent (no
    duplicates), symmetric across the two surfaces, and rolls the `offered=true`
    flag into `offeredOptionIds` so an included-in-price default stays included.
  - **Tourist-tax detail string on the PDF was meaningless for percentage-based
    tax.** The PDF read `full.touristTaxRate` (the base percentage / fixed-amount
    column) as a per-person-per-night unit. Fix per user request ("ce montant doit
    être géré par le backend"): `devisController.pdf` re-runs the pricing engine
    against the persisted devis and passes the live `quote` to `generateDevisPdf`;
    the PDF uses `quote.touristTaxUnitAmount × touristTaxAdultsCount ×
    touristTaxNights`, mirroring what PricingSummary shows live in the UI. Legacy
    no-quote callers (existing tests, ad-hoc invocations) keep the historical
    row-derived behaviour — additive `quote` parameter, no breaking signature
    change.
  - **Tourist-tax TOTAL line + grand TOTAL TTC stayed stale after a partial fix.**
    Follow-up to the same PR: the first round routed only the *detail string*
    through the engine quote but kept the displayed "Taxe de séjour" total line
    and the "TOTAL TTC" grand total on the persisted `full.touristTaxTotal` /
    `full.finalPrice`. Concrete user-reported case: PDF showed `Taxe de séjour
    15,36 €` while PricingSummary showed `16,80 €` on the same reservation
    (percentage tax + 10 % department surcharge). New pure helper
    `resolveLiveTaxTotals(full, quote)` in `utils/devisPdf.js` owns the
    resolution: live quote wins when provided, row is the legacy fallback,
    `quote.touristTaxTotal = 0` keeps the row (engine "didn't compute"), and
    `quote.finalPrice = 0` is honoured (offered stay). Pinned by 5 new invariant
    cases in `tests/devis-pdf-date-validity-tax.unit.test.js` (consistency
    invariant block). Spec §3.4 rule 20 added.

  **Non-regression coverage** (per user's explicit request): 4 new server unit
  test files, 29 cases, **899 / 899** server suite green.
  - `tests/devis-model-createdAt-validUntil.unit.test.js` (6 cases): explicit
    `createdAt` binding, `validUntil` formula, the `startDate - 2` cap, the legacy
    backfill on `update`, the persisted-override-wins case, and
    `convertFromReservation` parity.
  - `tests/devis-model-property-defaults.unit.test.js` (4 cases): merge,
    no-duplicate, no-defaults no-op, `offered` flag propagation.
  - `tests/reservations-controller-property-defaults.unit.test.js` (4 cases):
    symmetric coverage on the reservations side via a controller-level test that
    mocks the engine + model surface.
  - `tests/devis-pdf-date-validity-tax.unit.test.js` (15 cases): the
    `computeValidUntil` helper + a PDF render smoke per scenario the spec lists
    (PDFKit's content streams are FlateDecode-compressed, so byte-level inspection
    isn't reliable; the helper coverage + render smoke are the right shape) + 5
    consistency-invariant cases on `resolveLiveTaxTotals` pinning the live-quote-
    vs-row resolution (incl. the user's exact 15,36 € / 16,80 € regression).

  **Client-side Vitest mirror** (added when rebasing on the CRA → Vite branch,
  same day): 9 new cases pinning the symmetric "consume the engine quote, never
  re-derive" rule on the client.
  - `client/src/components/__tests__/PricingSummary.tourist-tax.test.js`
    (5 cases): displayed tax total reads `quote.touristTaxTotal` (the user's
    16,80 € exact scenario), detail breakdown reads the engine's `unitAmount ×
    adultsCount × nights`, engine zero overrides a stale form value, quote-omitted
    initial load falls back to the form (anti-flicker), `touristTaxLabel`
    rendered verbatim.
  - `client/src/utils/applyQuoteToForm.test.js` (+4 cases): the form-sync helper
    overwrites a stale `touristTaxTotal` on every recompute, an engine zero wins
    over a non-zero form value, `touristTaxRate` is copied verbatim, null/undef
    engine values map to 0 (no NaN leak into the form).

  **Forward-only**: no backfill SQL for the existing rows with bad/empty data.
  The defensive guards in `devisPdf.js` and the `update`-time `validUntil`
  backfill mean legacy devis still render correctly on the next reopen.

### Changed
- **Client build stack: Create React App → Vite** (spec `cra-to-vite-migration.md`,
  2026-06-04). The biggest single change since `V02.01.00`. Replaces `react-scripts`
  with `vite ^7` + `@vitejs/plugin-react` for the build/dev server, and migrates the
  test runner from Jest (via `react-scripts test`) to `vitest ^3`. All 19 existing
  client unit test files (144 cases) ported and stay green; the E2E smoke suite from
  PR #110 stays green and identical (**18 passed / 1 skipped / 0 failed**) — the
  migration's primary acceptance criterion per spec §7.1.

  Measured wins:
  - `npm audit` on the client tree: **42 vulnerabilities → 0 in production deps**.
    A single critical remains in `vitest` itself (CVE on its UI server which we
    NEVER expose — Vitest only runs in CI / locally). Down from 19 high / 14
    moderate / 9 low.
  - Production build wall time: **~40 s → 2 s** (Vite + Rollup + esbuild).
  - Dev server boot: **~30 s → ~1 s** (esbuild pre-bundling).
  - `npm warn deprecated` count on install: **~25 → 2** (the remaining two are
    `@mui/base@5.0.0-dev` and `recharts@2` — both unrelated to the build stack and
    addressable when those libraries are upgraded).
  - **Second-order win caught by Vite's strict ESM**: the first `npm run build`
    on this branch surfaced **two duplicate `complementPaid` keys** in the same
    object literal in `client/src/pages/ReservationPage.js` (lines ~938 and
    ~1707, both reservation-save build sites). CRA's Babel chain silently
    overlooked them; esbuild flags the construct as a hard warning. Three dead
    assignments removed, no behaviour change (last-write-wins was the same
    value), but a real code-quality cleanup the migration uncovered. Documented
    in the spec edge-cases section.

  Migration shape (single PR):
  - `client/`: `react-scripts` removed; `vite` + `@vitejs/plugin-react` + `vitest` +
    `jsdom` added. New `client/vite.config.js` + `client/vitest.config.js`. The
    HTML entry moves from `client/public/index.html` to `client/index.html` (Vite
    convention); `%PUBLIC_URL%` references resolve to `/` now.
  - `client/src/api.js`: `process.env.REACT_APP_API_URL` → `import.meta.env.VITE_API_URL`.
  - `client/src/utils/applyQuoteToForm.js`: lone CJS `module.exports = ...` →
    `export { ... }` (Vite's strict ESM caught it; CRA tolerated via Babel interop).
  - All 19 client tests + the shared `mockReservationForm.js` fixture: `jest.*` →
    `vi.*` calls + `import { vi } from 'vitest'`. `DevisPage.test.js` got the proper
    `vi.hoisted()` + `vi.importActual` pattern for hoisted mock-with-state cases.
    `StaySection.test.js` got the explicit `{ default: ... }` factory wrapper Vitest
    needs (Jest auto-wrapped a raw return).
  - `client/src/setupTests.js`: unchanged in spirit — auto-loads
    `@testing-library/jest-dom`; the temporary `globalThis.jest = vi` shim used
    during the porting was removed once every test file was converted.
  - `release.sh`: build path `client/build` → `client/dist`. The release archive
    still ships the bundle at `client/build/` (rename happens during `rsync`) so
    the Pi PM2 deploy layout stays backwards compatible.
  - `.github/workflows/deploy.yml`: drops `GENERATE_SOURCEMAP=false` env (now lives
    inside `vite.config.js` as `build.sourcemap = false`).
  - `README.md`: 3 mentions updated for Vite.
  - `.gitignore`: adds `client/dist/`.

  **Build output security posture preserved**: no sourcemaps in prod
  (`build.sourcemap = false`), zero inline runtime scripts (Vite's default — keeps
  the `script-src 'self'` CSP from PR #91), same proxy / cookie behaviour, same
  Pi deploy layout.

  **Out of scope** (each is its own future project, listed in spec §8): React
  18 → 19, MUI 5 → 9, react-router 6 → 7, TypeScript adoption, PWA. None of these
  is blocked by build tooling any more — Vite supports all of them.

  **Rollback** if needed: the tag `V02.01.00` snapshots the pre-migration master.
  `git push origin V02.01.00:release` redeploys the legacy CRA build with zero
  schema migration to undo (none happened).

### Added
- **E2E smoke suite with Playwright** — Wave 1 (spec
  `e2e-playwright-smoke-suite.md`, 2026-06-04). Phase 0 of the upcoming CRA → Vite
  migration: a safety net of browser-level tests that exercises the most user-visible
  flows on the CURRENT (CRA) app, then becomes the acceptance criterion for the Vite
  migration ("same suite must stay green after the swap"). Auto-runs on every PR
  targeting master + every push to master via the new
  `.github/workflows/e2e.yml` workflow (ubuntu-latest runner, free for public repos).

  Shipped this PR: **18 deterministic tests across 7 spec files** — Dashboard boot +
  zero console errors, 12 top-level routes render their header (sidebar nav graph
  pinned), Settings VAT round-trip, Linen stock 6-field round-trip, iCal date-drift +
  cancellation Dashboard cards seeded via DB helper and surfaced through the
  components shipped in PRs #104 / #106, mobile xs viewport drawer reachability.
  Wall time ~18 s end-to-end.

  Infrastructure: ephemeral SQLite per run (`/tmp/guestflow-e2e.db`) wiped by a
  pretest hook, deterministic admin seeded via the new `server/scripts/seed-e2e.js`,
  session cookie captured through the CRA proxy origin so every spec inherits an
  authenticated `storageState`, API + DB seed fixtures (`apiSeed.js` + `dbSeed.js`)
  for the rare cases where going through the real engine would be slow or
  non-deterministic.

  **Wave 2 follow-up** (separate PR, before the migration starts): the remaining 16
  specs from §3.4 of the spec — reservation create/edit, force-item-to-complement,
  disable-deposit, devis create + accept, CRUD round-trips, accounting CSV download,
  establishment closures gate. Skipped in Wave 1 because each needs careful UI
  inspection that's more efficient to do in a focused follow-up. One spec
  (`force-password-change`) is skipped with a documented reason — it calls
  `reset-admin.js` which `DELETE`s sessions and nukes the cached e2e admin cookie;
  needs a per-spec auth-isolation pattern to be safely re-enabled.

  Local dev: `npm run test:e2e` (headless) or `:headed` to watch. CI: report
  uploaded as a downloadable artifact on failure (interactive HTML with traces +
  screenshots, no comment in the PR thread — standard GitHub Actions check box is
  enough per user preference).

### Fixed
- **CI deploy log cleanup** (2026-06-04). Three deprecation-noise sources in
  `.github/workflows/deploy.yml` driven to zero:
  - `actions/checkout@v4` → `@v6` and `actions/setup-node@v4` → `@v6`. Eliminates the
    GitHub Actions warning `Node.js 20 actions are deprecated. ... will be forced to run
    with Node.js 24 by default starting June 16th, 2026`. The v6 majors of both actions
    run on Node 24 natively.
  - `npm rebuild --build-from-source better-sqlite3` → `env
    npm_config_build_from_source=true npm rebuild better-sqlite3`. The bare flag is NOT
    an npm CLI option (it's a `prebuild-install` convention) and recent npm versions
    reject it with two warnings: `"better-sqlite3" is being parsed as a normal command
    line argument` + `Unknown cli config "--build-from-source"`. The env-var form is the
    canonical entry point and survives the next npm major. Verified locally —
    `rebuilt dependencies successfully` with zero warning.

  Scope deliberately bounded: **42 client-side `npm audit` vulnerabilities** (19 high /
  14 moderate / 9 low) + ~25 `npm warn deprecated` lines during `client/ npm install` are
  ~90 % CRA transitive dependencies (`react-scripts 5.0.1` pulling stale jsdom / babel
  proposal plugins / workbox / svgo / eslint 8 trees). They cannot be fixed without
  migrating off CRA — a separate "migration project" tracked in the session memory.
  Server tree is clean (0 vulns; the 2 transitive deprecation warnings on
  `prebuild-install` + `node-domexception` are also CRA/jsdom-adjacent).

### Removed
- **Dead `deploy.sh` script** removed at the repo root (2026-06-04). The script was
  superseded by the GitHub Actions self-hosted runner (`.github/workflows/deploy.yml`)
  back in April 2026; nothing in the repo still referenced it. Removing keeps the
  surface area honest and was tactically convenient — it also hardcoded the Pi's LAN IP,
  which would otherwise have needed parameterising for the anonymisation pass below.

### Changed
- **Anonymised personal identifiers in public docs** (2026-06-04). The repo is public on
  GitHub; the HTTPS setup docs introduced over the last few weeks hardcoded the owner's
  business email, Free DDNS hostname, production subdomain, and Pi LAN IP — all
  indexable by anyone cloning the repo or browsing GitHub. A forward-only sed sweep
  replaces them with placeholders across `README.md`, `CHANGELOG.md`, and the helper
  scripts under `scripts/` + `server/scripts/`:
  | Real value | Placeholder |
  |---|---|
  | `contact@domainesolio.com` | `you@example.com` |
  | `maisonadrisoph.freeboxos.fr` / `.com` | `<your-freebox-dyndns>.freeboxos.fr` / `.com` |
  | `guestflow.domainesolio.com` | `<your-app>.<your-domain>` |
  | `www.domainesolio.com` | `www.example.com` |
  | `192.168.0.196` | `<your-pi-lan-ip>` |

  **Forward-only** by design: rewriting git history (`git filter-repo` + force-push)
  would break clones / forks and GitHub still caches old commit content via the API for
  weeks anyway, so the marginal benefit is low for a solo public repo. The trade-off
  was explicitly chosen on 2026-05-31. Brand names (Squarespace, Freebox / Free) stay
  in the docs as concrete worked examples — they are categories of provider, not
  personal identifiers.

### Fixed
- **iCal sync now re-claims a reservation when the platform re-issues its UID** on a date
  change (spec `ical-summary-fallback-cross-uid.md`, 2026-06-03). Investigation triggered
  by a confirmed prod case: an Abracadaroom reservation #144253 was rescheduled from
  06-07 Jun to 10-11 Oct, the platform emitted a brand-new UID for the move, and the
  engine's four existing fallbacks (all keyed on the NEW dates) failed to link the new
  event to the old reservation — the old one was silently deleted (pre-PR #106) or would
  now surface as a soft cancellation alert, while a fresh new reservation was created
  with none of the operator's manual edits carried over.

  A new step 3.5 in `syncSource()`'s matching cascade now searches
  `ical_import_events` by `(sourceId, summaryNormalized)` — the SUMMARY is the only thing
  that stays stable across the move on platforms like Abracadaroom or Booking.com (booking
  number embedded). Two safety guards keep the heuristic from misfiring:
  - **Staleness filter** — only candidates whose UID is NOT in the current feed are
    considered (those have genuinely disappeared from the platform's authoritative state).
  - **Uniqueness gate** — exactly one stale candidate. ≥ 2 stale matches → ambiguity →
    fall through to INSERT + the standard cancellation alert flow.

  Net effect: when the new event lands, the existing reservation row is preserved,
  `sourceIcalEventUid` is rewired to the new UID, and the existing date-drift detection
  (PR #104) does the rest — silent full update if the reservation is unlocked, orange
  Dashboard "Modifications de dates iCal" card if it's locked. No new tables, no new
  endpoints, no new UI; ~15 lines of engine code + 4 dedicated tests.

### Changed
- **iCal sync no longer auto-deletes cancelled reservations** (spec
  `ical-cancellation-approval.md`, 2026-06-03). Previously, when a reservation's UID fell
  out of every source feed, the engine silently deleted it — including locked,
  user-edited reservations. The engine now records ONE pending cancellation per
  reservation in `ical_cancellation_alerts` (UPSERT — multiple sources dropping the same
  UID in cascade don't duplicate the alert). The Dashboard mounts a new
  `<IcalCancellationAlert />` orange card listing every pending cancellation with three
  per-row actions:
  - **Supprimer** → atomic delete: history audit entry → DELETE reservations →
    DELETE ical_import_events. Idempotent shape (`outcome: 'reservation_gone'`) if the
    reservation was already manually removed between sync and click.
  - **Voir la fiche** → opens the reservation without acknowledging.
  - **✕** → ignores the proposal; the reservation stays as a "detached" iCal-origin row.

  Auto-resolve: at the top of every `syncSource()` call, pending alerts whose
  `(sourceId, eventUid)` matches an incoming feed event are silently deleted (the
  platform un-cancelled the booking). Cross-platform protection is preserved — the
  alert only fires once every iCal source has dropped the UID. The sync result's
  `removedCount` keeps its key but its meaning shifts to "cancellation alerts raised";
  the user-facing status string was reworded to `… annulation(s) à valider`. 24 new
  server tests pinning the contract (model UPSERT + auto-resolve + atomic approve +
  reject, sync engine soft flow + cross-platform protection + auto-resolve, controller
  HTTP shaping for the 3 new endpoints).

- **Single global VAT rate** (spec `single-vat-rate.md`, 2026-06-03). The previous 2-rate
  model — 10 % for accommodation, 20 % for everything else — was collapsed to ONE editable
  rate (default 10 %) after the comptable confirmed every revenue stream on a GuestFlow
  installation is invoiced under the reduced rate. The Settings page exposes one field
  "Taux de TVA (%)"; the pricing engine, devis PDF, finance reporting, accounting model
  and accounting CSV export all consume the single rate. The quote payload keeps the three
  `vatPercentageAccommodation` / `vatPercentageOptions` / `vatPercentageResources` keys
  (downstream readers untouched) — they all hold the same value now. PricingSummary's
  per-bucket HT/VAT breakdown collapses to a single "TVA {rate} %" line.
  - **Retroactive**: historical reservations re-export at the new rate. The accounting CSV
    emits ONE VAT line per encaissement on account `44571100` (TVA 10 %); no more
    `44571200` rows. Past TTC totals are unchanged; only the HT / VAT split shifts.
  - The `vatAccountForRate` resolver + `STANDARD_20` constant stay defined as dormant
    safety nets: if the editable field is ever set to 20 % temporarily, the export still
    maps to the right GL account without code change.
  - Test sweep: 12 server test fixtures collapsed from 2-rate to single-rate; the dedicated
    `pricing-vat-two-rates.unit.test.js` was renamed (`git mv`) to
    `pricing-vat-single-rate.unit.test.js` and rewritten.

### Added
- **iCal date-drift Dashboard approval** (spec `ical-sync-override-locked-dates.md`,
  2026-06-03). Previously, an iCal reservation that had been opened+saved through the form
  became `icalSyncLocked = 1` and the sync engine then ignored EVERY subsequent change from
  the source platform — including date moves, the most safety-critical mutation for
  overbooking prevention. The new flow detects locked date drifts during `syncSource()`,
  records ONE pending row per reservation in `ical_date_drift_alerts` (UPSERT semantics — a
  later proposal replaces the previous one), and exposes them as an orange Dashboard
  `<IcalDateDriftAlert />` card. Each card offers:
  - **Approuver** → runs a NARROW SQL override touching only `startDate`, `endDate`,
    `updatedAt`. Bed config, guest counts, options, resources, prices, payments, lock flag
    are explicitly preserved (rules 6+7).
  - **Voir la fiche** → opens the reservation page without acknowledging.
  - **✕** (top-right) → ignores the proposal; the reservation stays at its persisted dates.

  Acknowledged rows are kept indefinitely for audit. Approved overrides emit a
  `reservation_history` entry labelled "Dates iCal approuvées" so the change appears in the
  audit log. Unlocked reservations + summary-only locked drifts keep their existing behavior
  (full update path / silent skip respectively). 23 new server tests pinning the contract
  (engine drift detection, idempotency on repeated syncs, latest-proposal-wins UPSERT,
  approve/reject atomicity, controller HTTP shaping). Known follow-up: a locked reservation
  receiving a NEW UID alongside the date change still falls through to insert+delete (loses
  user data) — separate sync-engine rework needed; tracked as a follow-up.
- **Linen inventory & shortage projection** (spec `linen-inventory-shortage-tracking.md`,
  2026-06-03). Adrien declares his global stock (3 bed types + 3 towel types) in the new
  `/parametres/stock-blanchisserie` sub-page. A pure simulation engine
  (`server/src/utils/linenInventory.js`) walks day-by-day from today to the last reservation's
  endDate, modelling 4 buckets per type (`clean` / `inCirculation` / `dirty` / `atLaundry`)
  with the conservation invariant `clean + inCirculation + dirty + atLaundry = stock` asserted
  on every day. Pick-up on a laundry day runs BEFORE check-in (rule 6) so a same-day arrival
  is served by the freshly returned linen. Two new endpoints:
  - `GET /api/planning/linen-inventory` → per-laundry-day clean snapshot, consumed by
    `LaundryDayCard`'s new third block "Disponible après ce dépôt :" with red highlighting
    on negative values (rule 35).
  - `GET /api/dashboard/linen-shortage` → grouped-by-type shortage list (first date, max
    missing, impacted reservations) consumed by the new `<LinenShortageAlert />` mounted at the
    top of the Dashboard. Empty when no shortage; clickable reservation chips navigate to the
    reservation page.

  Six new columns on `app_settings` (`bedLinenStockSingle / Double / Baby`, `towelStock
  Large / Medium / Small`), all integer ≥ 0 capped at 999 by `validateLinenStockCount`. **Stock
  = 0 ⇒ "type not tracked"**: the simulation skips it and the UI omits any line for it (Planning
  3rd block, Dashboard alert) — keeps the surfaces clean for partially-tracked installs.

  53 new server tests pinning the engine (conservation, devis exclusion, property-default
  fallback, explicit-wins-over-default, bathroom qty sub-occupation factor, same-day pickup
  ordering, shortage detection + impacted reservations).

### Fixed
- **Planning: a Tuesday with ONLY a laundry card now renders** (rule 13.ter, 2026-06-03). The
  day-set merger in `PlanningPage` previously only collected dates from arrivals, departures,
  and resource bookings. A laundry day that fell on a date with none of those (typical after
  activating property defaults on a quiet week) silently disappeared. The merger now also
  consumes `laundryByDate` keys, filtered to those that pass the `LaundryDayCard` silence
  check (`sum(dropOff) + sum(pickUp) > 0`).

### Changed
- **Property defaults now drive the laundry counter for ALL reservations of that property —
  past and future** (spec `weekly-bed-linen-tracking.md` rule 36, 2026-06-03). When the
  operator activates a linen option as default on a property, every reservation of that
  property contributes to the laundry counter even if the option isn't in the reservation's
  `reservation_options`. Covers: pre-feature reservations (no option ticked), edge cases where
  the operator unticked the option, and any future reservation regardless of creation path.
  SQL: each aggregation (`dropOffForWindow`, `dropOffBathroomForWindow`) UNION ALLs an
  explicit-row source and a property-default-fallback source inside its `sub` JOIN; the
  fallback is suppressed by `NOT EXISTS` when an explicit row is present so operator intent
  (linenIncludes* flags + bathroom qtySum sub-occupation factor) is never silently overridden.
  Devis exclusion still wins.

### Added
- **Per-property option defaults** (spec `weekly-bed-linen-tracking.md` §3.7, 2026-06-03).
  Adrien can declare, per logement, that one or more linen options are added by default on
  every NEW reservation for that property, optionally with the offered flag pre-set ("le
  linge est inclus dans le tarif"). New table `property_option_defaults(propertyId, optionId,
  offered)` decoupled from `property_options` (the availability filter remains untouched).
  Four new API endpoints under `/api/properties/:id/option-defaults` (GET / PUT / DELETE) +
  `/api/options/:id/property-defaults` (read-only mirror). Two UI surfaces per Adrien's UX
  choice: PropertyDetail card "Options ajoutées par défaut" with immediate-save switches
  (canonical edit) + OptionsPage section "Logements par défaut" listing the same data
  read-only when editing a linen option. ReservationPage auto-pre-populates `selectedOptions`
  on **new** reservation creation (and on property change mid-creation) using
  `GET /api/properties/:id/option-defaults`. Edit of an existing reservation NEVER re-applies
  defaults (rule 30 — historical bookings stay frozen). Soft-fails on the defaults fetch so a
  defaults outage never blocks the reservation flow. **Rule 35 follow-up**: when the operator
  toggles an option back ON on an existing reservation (remove → re-add), the `offered` flag
  is set from the property's default for that option (default `offered=true` → free, default
  `offered=false` → paid, no default → preserve historical state). The cache is refreshed via
  a useEffect watching `form.propertyId` so the contract is honoured on edit-load too.
- **Weekly bed-linen tracking on the Planning page** (spec
  `weekly-bed-linen-tracking.md`, 2026-06-02). Each laundry day (configurable weekday, default
  Tuesday) now surfaces a small card under the day header of the Planning view showing the
  number of sheet sets to bring (single + double + baby, summed across every checkout since the
  previous laundry day on reservations that include a linen-flagged option) and to pick up (the
  previous laundry day's drop-off). Both sides are independent — a quiet week renders nothing.
  - New per-option flag `countsAsBedLinen` (and `countsAsBathroomLinen` for the towels
    counterpart). Pure metadata — zero pricing impact. Both flags are **invisible in the UI**
    (the OptionsPage form does not show a control for them): the typed seeds + title-alias
    promotion guarantee the flags are set on the right rows automatically.
  - **Default "Linge de lit" option seeded at boot** — undeletable in the UI via
    `autoOptionType='bed_linen'` (same pattern as the early/late check-in options). The seed
    has three branches: idempotent skip when the typed row exists; **promote in place** when
    an existing option already carries `countsAsBedLinen=1` OR has a title in the short
    `KNOWN_TITLE_ALIASES` list (`'linge de lit'`, `'linge de lits'` — case-insensitive +
    trim-tolerant), so legacy prod rows are picked up transparently with no manual cleanup;
    fresh insert otherwise. The promotion keeps Adrien's name / price / description and just
    adds the `autoOptionType` marker + `countsAsBedLinen=1`. Same shape for the bathroom-linen
    seed with `KNOWN_TITLE_ALIASES = ['linge de toilette']`.
  - **Bathroom-linen tracking (towels) — §3.5.bis follow-up.** Strict mirror of the bed-linen
    feature: a second independent flag `countsAsBathroomLinen`, a default **"Linge de toilette"**
    seed (`autoOptionType = 'bathroom_linen'`, same non-destructive contract), and a second
    sub-line *"Serviettes: N grandes · N moyennes · N petites"* under the same "À apporter /
    À récupérer" headers in the LaundryDayCard. **The towel count SCALES by
    `reservation_options.quantity`** (asymmetric with bed-linen which ignores quantity) — the
    seed is `priceType = per_person` and the operator uses the quantity field as a
    sub-occupation factor (e.g. `0.6667` on a 3-person stay = "2 of 3 want towels").
  - **§3.5.ter — per-type linen configuration on the option.** Six new columns on `options`:
    `linenIncludesSingle / Double / Baby` (1/0, default 1 — drive 3 checkboxes shown in the
    option form when `countsAsBedLinen=1`) and `towelLargePerPerson / Medium / Small`
    (integers ≥ 0, defaults 1 / 0 / 1 — drive 3 number inputs shown when
    `countsAsBathroomLinen=1`). Bed-linen formula now gates each bed-type sum on its include
    flag; bathroom-linen formula becomes
    `ROUND(persons × Σ quantity × MAX(towel<Size>PerPerson))` per size. A multiplier at 0
    silences that size in the LaundryDayCard (rule 13.bis). Defaults preserve the previous
    "all bed types ON, 1 large + 1 small per person" semantic — no migration needed for
    existing installs.
  - New global setting `laundryWeekday` (0 = Sunday … 6 = Saturday, default 2 = Tuesday)
    configurable in *Paramètres → Linge & blanchisserie*.
  - New endpoint `GET /api/planning/laundry?from=…&to=…` returning every laundry-day occurrence
    in the range with its `dropOff` + `pickUp` payloads. The client filters silent days.
  - Server-side aggregation honours: `kind='reservation'` only, `offered=true` still counts,
    option `quantity` is ignored (1 reservation = 1 set per bed), multiple linen-flagged options
    on the same reservation still count once, window is `(L-7d, L]` (a check-out the laundry
    morning joins that day's batch).
- **Self-service email edit on `/account` with a persistent anti-lockout safety net** (spec
  `admin-account-management.md` follow-up #7, 2026-06-02). The "Mes informations" email field is
  now editable for every authenticated user — the bootstrap admin can replace the
  `admin@guestflow.local` seed with a real address (the same one that's used to log in). To make
  this safe given that the email IS the login identifier:
  - `PUT /api/users/me` accepts an optional `email` key — normalised, validated, unique-checked
    (`400 INVALID_EMAIL`, `409 EMAIL_ALREADY_EXISTS`). Same-value is a no-op. `roles` still
    stripped server-side (privilege guard unchanged).
  - `GET /api/users/me/email-status` now returns
    `{ myEmail, defaultStillUsed, mustVerifyNewEmail, emailChangedAt }`. `defaultStillUsed`
    drives the red highlight on the email field in SelfProfileSection when the operator is still
    on the seed; `mustVerifyNewEmail` drives the new persistent banner.
  - **`EmailVerifyBanner`** mounted in `AppShell` — visible on every page until the operator has
    logged out and logged back in once with the new email (closes the typo-then-logout lockout).
    Self-clearing: the login flow updates `lastLoginAt`, the banner detects it on the next poll
    and disappears. The CLI recovery command is documented in the README, not surfaced in the UI
    (the banner is visible to every role, not just the admin).
  - **`npm run reset-admin` recovery extended** — now handles the case where the operator
    changed their email and forgot it: the OLDEST admin row is renamed back to
    `admin@guestflow.local` instead of silently creating a second admin row. `emailChangedAt` is
    also cleared on reset so the recovered account doesn't show the verification banner.

### Migration
- **`ical_cancellation_alerts`** — new table (id, reservationId, sourceId, eventUid,
  detectedAt, acknowledgedAt, outcome). Three partial indexes on `acknowledgedAt IS NULL`
  (Dashboard listing, per-reservation UPSERT, per-event auto-resolve lookup). Created
  idempotently on first boot. Empty on existing installs.
- **VAT schema collapse** — `app_settings` gains a new column `vatRate REAL NOT NULL DEFAULT
  10`; the migration seeds it once from the legacy `vatRateAccommodation` value (prod has
  10 % there → no behavioural surprise), then DROPs both `vatRateAccommodation` and
  `vatRateStandard`. Idempotent on re-runs (the DROP guards on `cols.includes(...)`).
  SQLite ≥ 3.35 (well below the Pi's bundled version) supports DROP COLUMN.
- **`ical_date_drift_alerts`** — new table (id, reservationId, previousStart/End,
  newStart/End, detectedAt, acknowledgedAt, outcome). Created idempotently on first boot.
  Two partial indexes on `acknowledgedAt IS NULL` for the Dashboard listing and the
  per-reservation UPSERT lookup. Empty on existing installs.
- **6 new columns on `app_settings`** for the linen-inventory feature: `bedLinenStock
  Single / Double / Baby`, `towelStockLarge / Medium / Small` — all `INTEGER NOT NULL DEFAULT
  0`. Idempotent ALTER TABLE; existing installs see 0 everywhere = "no type tracked" = no UI
  change.
- **`property_option_defaults`** (§3.7) — new table created on first boot, primary key
  `(propertyId, optionId)`, ON DELETE CASCADE on both FKs. Empty on existing installs; no
  data migration needed. Decoupled from the existing `property_options` table to preserve the
  current "global option = available everywhere" semantic.
- **`users.emailChangedAt`** (`TEXT NULL`) added by an idempotent ALTER TABLE in
  `server/src/database.js`. Stamped by `updateUser` whenever the email column is rewritten.
  Existing users see `NULL` → no banner, no behaviour change until they actually change their
  email.
- **`options.countsAsBedLinen`**, **`options.countsAsBathroomLinen`** (both `INTEGER NOT NULL
  DEFAULT 0`) and **`app_settings.laundryWeekday`** (`INTEGER NOT NULL DEFAULT 2`) added by
  idempotent ALTER TABLE in `server/src/database.js`. Existing options default to "not a linen
  option" on both flags (the feature stays silent until Adrien ticks them). Default weekday =
  Tuesday.
- **§3.5.ter** adds six more columns on `options`, all idempotent ALTER TABLE:
  - `linenIncludesSingle`, `linenIncludesDouble`, `linenIncludesBaby` (INT 0/1, default 1)
  - `towelLargePerPerson`, `towelMediumPerPerson`, `towelSmallPerPerson` (INT ≥ 0, defaults
    1 / 0 / 1)

  Defaults match the pre-existing semantic so no row needs backfill.

### Changed
- **PlanningPage day-card colour palette** (spec `weekly-bed-linen-tracking.md` §6.1, follow-up
  2026-06-02). Replaced the flat white default on every day-cell card to give a clearer visual
  hierarchy at a glance:
  - **LaundryDayCard**: laundry-themed cyan (`cyan[50]` bg + `cyan[200]` border + `cyan[800]`
    icon/title) — visually the most prominent of the three card types.
  - **ReservationCard (arrivée)**: warm peach background (`orange[50]`) when no alert is firing —
    welcoming, attention-grabbing without being flashy. Alert (orange / red / blue) and "done"
    (green) overlays still take priority.
  - **DepartureMiniRow (départ)**: very pale grey (`grey[100]`) — deliberately quieter than the
    arrival peach so arrivals dominate the eye at a glance.
- **Accountant CSV export aligned with the SOLIO example** (spec
  `accountant-accounting-export.md` §3.4 rules 13–16, resolves §9 Q1). After Adrien received the
  `Exemple export ventes SOLIO.csv` reference file, the accountant CSV now matches it column-for-
  column on the 9 mandatory columns:

  ```
  Jour ; Mois  ; Année ; Journal ; Pièce ; Libellé de l'écriture ; Compte ; Débit ; Crédit
  ```

  - Header `Mois ` carries a trailing space byte-for-byte from the example file.
  - `Journal` constant `VT` (Ventes).
  - `Pièce` empty for now — left blank until Adrien settles a numbering scheme with the
    accountant. The column stays in the header.
  - `Libellé de l'écriture` uppercased "FIRSTNAME LASTNAME" (`CLAIRE NOTIN`).
  - `Débit` / `Crédit`: counter-side cells render as literal `0` (the accountant's software
    ingests these numeric); whole numbers render bare (`144`, `0`); fractions render with French
    comma decimal at 2 places (`519,17`).
  - Client account format relaxed: `C` + first 6 chars of last name, **no padding** (matches
    SOLIO's variable-width codes `CNOTIN`, `CCAGGUI`). Empty / unknown → literal `CXXXXX`.
  - GuestFlow extension columns kept: `Plateforme;Prix payé client;Commission` — appear after the
    9 SOLIO columns on the debit row only. The accountant ignores them; Adrien still sees the
    platform info in the same file. (Per Adrien's choice over a separate file or dropping them.)
  - **Encoding**: switched from UTF-8 BOM to **ISO-8859-1 (latin1)** without BOM. French
    accounting software defaults to latin1 and chokes on the BOM. The controller now serves
    `Content-Type: text/csv; charset=ISO-8859-1` with a `Buffer.from(csv, 'latin1')` body.

- **Tourist tax re-included in the journal as a `46710000` pass-through line** (policy change
  2026-06-01 from the SOLIO example). Previously, the tax was stripped from the accountant
  journal entirely ("tax reported via Suivi taxe de séjour, not the journal"). The SOLIO example
  credits the tax on `46710000` ("compte d'attente" — the owner owes it to the commune, not
  turnover), and the accountant needs both sides of every encaissement balanced. Each entry now
  carries a `taxTtc` field surfaced from the per-bucket capture columns
  (`touristTax{Acompte,Solde}ContribTtc`); when > 0, the export emits a credit on `46710000`.
  The Suivi taxe de séjour page stays — it's the operational view. The full encaissement TTC
  (revenue + tax) is now the debit, where previously the debit was revenue-only.

  - Pure-tax encaissements (the complement entry on an owner-collected non-direct booking with
    no extras) are no longer dropped — they emit as a valid 1-debit + 1-credit row on `46710000`.

  Tests: `accounting-csv-solio-format.unit.test.js` (7 new pinned-format cases byte-comparing
  the produced CSV to the SOLIO example) + updates to `accounting-export.unit.test.js` (10
  tests rewritten for the new column layout), `accounting-model-tourist-tax.unit.test.js` (3
  tests rewritten for the new policy), `accounting-per-line-contribs.unit.test.js` (1 test
  rewritten), `csv.unit.test.js` (integer-render rule).

  Migration: no DB change. Existing reservations re-export with the new format automatically.

### Added
- **Per-item routing to Complément à percevoir** (spec
  `force-item-to-complement.md`). The reservation form now exposes two layers of control over
  which payment bucket each line lands in:
  1. **Manual override** via a discreet `Compl.` checkbox on every option, resource and custom
     option in the reservation editor, plus a `Taxe de séjour en complément` switch in the
     Finance card. When ON, the line (or the tax) bypasses the auto deposit/balance split and
     lives 100 % in the Complément entry — both in the live PricingSummary (italic gray
     `compl.` chip next to the libellé) and in the accounting export.
  2. **Per-line per-bucket snapshots** captured on every `depositPaid` / `balancePaid` 0→1
     flip — `acompteContribTtc` + `soldeContribTtc` on each option / resource / custom-option
     row, plus `accommodation*ContribTtc` / `touristTax*ContribTtc` on the reservation row.
     These freeze the exact attribution of each encaissement at its moment of capture, so the
     monthly accounting journal keeps reading the original numbers even if a line's price
     grows afterwards. Conservation is asserted inside a transaction: if the sum of contribs
     ≠ the encaissement amount within ±0.01 €, the capture rolls back together with the
     payment flip. The accounting model reads the contribs directly; when a reservation has no
     contribs (pre-feature data), it falls back to the historic pro-rating logic so existing
     exports stay byte-identical.
  Wired through:
  - 14 new DB columns added via the existing idempotent ALTER-pattern in `database.js`
    (4 forced flags + 6 per-line per-bucket contribs + 4 reservation-level per-bucket contribs).
  - A new helper `server/src/utils/forceItemContribsCapture.js` driving the capture, the
    conservation invariant assertion and the un-flip clearing.
  - The pricing engine (`server/src/utils/pricing.js`) subtracts forced lines + a
    complement-routed tax from `preArrivalAmount` and returns per-line `inComplement` /
    contribs in `quote.optionLines[i]` / `quote.resourceLines[i]` so the client can render the
    split.
  - `accountingModel.buildEntry` reads per-line contribs to populate exact per-bucket TTCs
    per entry kind; legacy reservations keep the pro-rating fallback.
  - Client: form state + 4 payload-build sites in `ReservationPage.js`, Compl. checkbox in
    `ExtrasSection.js`, tax Switch in `FinanceSection.js`, line-duplication logic + chip in
    `PricingSummary.js`. The chip styling per spec §6.2 (italic gray outlined chip,
    `compl.` label, 18 px height).
  Tests: 37 new cases across 3 files — `pricing-force-and-snapshot` (15), `payment-contrib-
  capture` (13), `accounting-per-line-contribs` (9). Existing 530+ tests stay green; in
  particular the legacy-fallback test pins the accounting export at byte-identical output for
  any reservation with NULL contribs.

  Migration note: idempotent ALTER TABLE for every new column. No existing data touched. New
  contribs columns default to NULL on every row; the accounting model treats "all NULL" as
  "legacy mode" → no behavioural change for existing reservations until they receive a fresh
  payment flip under the new code.

  **Follow-up on 2026-06-01 (Adrien feedback):**
  - Auto-options (arrivée anticipée / départ tardif) can now also be routed to Complément via
    the same `Compl.` checkbox in the editor. Wired through a new `autoOptionsInComplement`
    array on the form / payload / engine (auto-options aren't in `selectedOptions`, so they
    need a parallel channel). The engine writes their `inComplement` to `reservation_options`
    on save; loads back from there. Backward-compat: a locked snapshot with `inComplement = 1`
    keeps the routing even without the array.
  - The PricingSummary chip is now **clickable** — the user can flip a line in/out of
    Complément directly from the summary, mirroring the FinanceSection checkbox. Two states:
    bold outlined `compl.` when active, faded `+ compl.` when inactive (discoverable). The
    `delta` row of a split (post-payment growth) stays read-only — flipping it would break
    conservation against the encaissements already recorded. Same for the tourist-tax row —
    the chip there mirrors the Switch in FinanceSection.

- **Per-reservation "Désactiver l'acompte" toggle** (spec
  `disable-deposit-per-reservation.md`). A new `Switch` next to the "Acompte" title in
  `ReservationPage → FinanceSection` lets the admin declare that a given reservation
  has no deposit concept at all — typical case: bookings where the platform
  (Airbnb / Booking) collects the deposit on the owner's behalf and it never transits
  through the owner's accounts. When ON, the pricing engine collapses `depositAmount`
  to 0, `balanceAmount` absorbs the whole pre-arrival total, and the controller
  force-zeroes `depositPaid` + `depositPaidDate` before persisting. Net result for the
  accountant: the reservation produces **one journal entry** (the balance) instead of
  two — the existing accounting export logic at
  [accountingModel.js:54-56](server/src/models/accountingModel.js#L54-L56) emits a
  deposit row only when `depositPaid=1`, so no extra accounting code was needed; the
  upstream pipeline does all the work.

  Wired through:
  - New column `reservations.depositDisabled INTEGER NOT NULL DEFAULT 0` added via the
    existing `if (!cols.includes(...))` migration pattern in `database.js`. Default 0
    for every existing reservation, so behaviour is opt-in per reservation.
  - `reservationsModel.insertReservation` + `updateReservation` carry the column;
    `getAuditSnapshotFromDb` includes it so toggle changes show up in
    `reservation_history` like any other field edit. `reservationAudit` declares the
    label `Acompte désactivé` so the history viewer renders it readably.
  - `pricing.js` (`calculateReservationQuote`): when `depositDisabled` is truthy,
    short-circuit `resolvedDepositAmount = 0` + `resolvedBalanceAmount =
    preArrivalAmount` + `depositDueDate = null`. The branch sits BEFORE the existing
    `depositPaid/balancePaid` ladder so the flag always wins. Critical: this means the
    toggle survives every recompute — the previous design idea ("just mutate
    `depositAmount=0` in the body") was rejected because the engine would re-derive
    `autoDepositAmount = preArrivalAmount × depositPercent / 100` on the next save and
    silently restore the deposit.
  - `reservationsController.update` + `.create`: read `req.body.depositDisabled`, pass
    the flag to `calculateReservationQuote`, and on `update` build a derived
    `modelPayload` that force-zeroes `depositPaid` + `depositPaidDate` whenever the
    flag is ON. `depositDisabled` is also added to the 14-field past-lock allowlist
    so an admin can flip it on a past reservation (typical retroactive correction
    after spotting a platform booking that had been treated as direct).
  - `FinanceSection.js` renders a small `Switch` next to the "Acompte" title. OFF =
    standard deposit UI as today. ON = the entire deposit block (montant +
    échéance + bouton "Marquer payé" + date paiement) collapses to a single muted line
    *"Acompte désactivé — ajouté au solde."* The Switch stays visible for re-toggle.
    The Solde block is unchanged visually; its amount is just higher because the
    engine has already consolidated the split.
  - `ReservationPage.js`: `depositDisabled` added to the form state, the live
    `formSnapshot` memo deps, the 4 payload-build sites (calc preview ×3 + final
    save), and the load-from-server step (`res.depositDisabled → form`). The final
    save also force-zeroes `depositPaid` / `depositPaidDate` client-side when the
    toggle is ON — server enforces the same; the client mirror keeps the UI
    consistent immediately.

  **Lossiness on flip-back** (documented in the spec, Adrien's call 2026-06-01):
  flipping ON → OFF doesn't restore the original deposit value. The engine recomputes
  from `property.depositPercent` — same as for a fresh reservation. Acceptable for the
  platform-handles-deposit use case where the original split was irrelevant anyway.

  Tests: 7 new cases in `pricing-deposit-disabled.unit.test.js` (default regression,
  ON collapses deposit/absorbs balance, boolean variant accepted, survives repeated
  recompute calls, depositPercent=0 edge case, flag wins over a stale `depositPaid=true`,
  every falsy variant is a no-op). All 7 pass at first run.

  **Follow-up on 2026-06-01 (Adrien feedback):** the toggle was visible in
  `FinanceSection` but the rest of the UI kept showing "Acompte: 0€ Dû [null]" or
  "Acompte non payé" for depositDisabled reservations — visually inconsistent with
  the toggle's intent. Patched the four remaining surfaces:
  - `PricingSummary` (the recap card next to the reservation form): the Acompte row
    now renders an italic muted `Désactivé (ajouté au solde)` instead of `0.00€`,
    and the due-date caption + "Acompte payé" chip are hidden.
  - `Dashboard.js` line 248 status line: the `Acompte NON` part now reads `OK` when
    `r.depositDisabled` is on — there's nothing to chase. The Solde part is
    unchanged.
  - `FinancePage.js` projection table (line ~195): the Acompte cell now shows
    `Désactivé` italicised instead of `0€ + chip "Dû [null date]"`.
  - `FinancePage.js` pending-payments table (line ~319): the Acompte cell now shows
    `Désactivé` instead of the unchecked checkbox + `0€` + null due-date.
  - `FinancePage.js` summary chip line (line ~433): the per-reservation chip row
    renders `Acompte désactivé` (italic) instead of `Acompte non payé`.
  Server propagation: `financeModel.getProjection` now includes `depositDisabled` in
  the per-reservation detail it returns (the projection used to omit the flag, so
  the projection table didn't see it). All other endpoints already passed the column
  through via the existing `SELECT r.*` patterns.
- **Admin-only escape hatch for editing past reservations** (spec
  `admin-unlock-past-reservations.md`). The server-side lock that gates `PUT
  /api/reservations/:id` to a 14-field allowlist once `startDate <= today`, and the
  one that returns 403 on `DELETE /api/reservations/:id` once `endDate < today`, both
  drop to a no-op when the new `Paramètres → Réservations passées` toggle is ON. OFF
  by default — every existing install and every fresh deploy keeps the current
  behaviour. Wired through:
  - A new boolean column `app_settings.allowEditPastReservations`
    (`INTEGER NOT NULL DEFAULT 0`) added via the existing idempotent
    `tryAddAppSettingsCol` helper in `database.js`.
  - A new helper `settingsModel.allowEditPastReservations()` returning a boolean; both
    lock check sites in `reservationsController.update` and `.remove` now read it
    before applying their guard.
  - A new `reservations` group in the GET/PUT settings payload — exposed verbatim by
    `settingsResponse.shapeResponse` and accepted by `settingsController.updateSettings`
    via `RESERVATIONS_FIELDS` + `BOOLEAN_INT_COLUMNS` (the same INTEGER coercion path
    that already handles `smtpSecure`).
  - A new client component `SettingsReservationLockSection.js` (Card → Stack → h6 →
    caption → Switch, mirrors `SettingsVatSection`'s shape) mounted in `SettingsPage`
    between the VAT and Google Calendar cards.
  - In `ReservationPage.js`, the existing `setExistingReservationLocked` call now also
    consults the setting (`api.getSettings()` is loaded in parallel with the reservation
    itself); when ON, `isReservationLocked` is `false`, so the banner, the opacity / no-
    pointer-events grey-out on Stay+Notes, and the Delete-button disabling all
    short-circuit on their existing checks. **No new visual indicator on
    ReservationPage when ON** (Adrien's choice, 2026-06-01) — the toggle state lives
    only in Paramètres.
  - **Follow-up on 2026-06-01 (Adrien feedback):** a third lock surfaced during the
    first test, in `reservationsModel.validateAvailability` (line ~269), which hard-
    rejected any payload with `startDate < today` and `'Impossible de réserver dans le
    passé.'` That guard fires inside both create and update flows, so even with the
    controller-level lock lifted by the toggle, editing a past reservation that kept
    its (past) startDate still failed. Fixed: `validateAvailability` gains an 8th
    `options = {}` parameter; the past-date guard is now
    `if (startDate < today && !options.allowPastDates)`. Both controller call sites
    pass `{ allowPastDates: settingsModel.allowEditPastReservations() }`. Overlap /
    capacity / closure checks are unchanged. Spec §1, §3.1 + §3.5, and §4.1 updated to
    reflect three lock sites instead of two.
  Restricted to admin: settings endpoints are already admin-gated by
  `enforceRoleAccess`, so an accountant never sees the card or can write the column.
  Tests: 5 new cases in `settings-model.unit.test.js` (default value, round-trip,
  coercion table, preservation through unrelated upserts). Controller-side coverage
  is deliberately scoped to the model helper — the boolean composition
  `isPast && !allowEdit` in the controller is a 2-line change and the helper is
  fully exercised at the model level; a controller integration test would require
  refactoring for DI (out of scope for this small change).

### Security
- **Hardening pass — follow-up to the 2026-06-01 security audit.** Eight defense-in-depth
  fixes touching the request path, build pipeline, and database layer. Closes the audit's
  H1, M1-3, M5-6, L1 findings; no audit-level critical was found.
  - **H1 — Source maps no longer shipped to prod.** CI step `⚛️ Build React client`
    sets `GENERATE_SOURCEMAP=false` before `npm run build`, so
    `/static/js/main.*.js.map` is never generated. Previously it was publicly fetchable
    on `<your-app>.<your-domain>` and leaked the full un-minified bundle (module
    tree, original variable names, compile-time constants).
  - **M1 — Explicit JSON body size limit (256kb).** `express.json()` was using the
    Express default of 100 KB without an explicit cap. Pinned to 256 KB so a runaway
    client or post-auth attacker can't eat the Pi's RAM via a multi-MB body.
  - **M2 — Server `npm audit` to zero vulnerabilities.** `npm audit fix` cleared the
    3 moderate `qs` advisories (reaches via `body-parser`/`express`). The remaining
    `uuid@9` advisory was sidestepped by `npm uninstall uuid` — it was a direct dep
    with no callers in `server/src/` (orphan from an earlier refactor). Final:
    `found 0 vulnerabilities`.
  - **M3 — `err.message` no longer echoed back to API clients.** Seven controller
    branches returned raw library error messages in the response body (SMTP transport
    rejects, Google API stack hints, Sharp/Multer file-path crumbs — gratis
    fingerprinting for an attacker). Replaced with stable error codes; the full
    detail is logged server-side via `console.error`. Touched:
    `googleCalendarController` (testConnection, syncReservations),
    `settingsController.sendSmtpTest`, `usersController.create + resetPassword`,
    `icalController` (3 handlers), `propertiesController` (create + update). Test
    `users-controller.unit.test.js` updated to assert the absence of any leak
    (`assert.equal(res.body.detail, undefined)`).
  - **L1 — `Permissions-Policy` header added.** Helmet 7 doesn't ship this header so
    we set it ourselves in [`server/src/index.js`](server/src/index.js), denying
    `camera`, `microphone`, `geolocation`, `payment`, `usb`, `accelerometer`,
    `gyroscope`, `magnetometer` to every origin; `fullscreen` locked to `self`. Value
    lives as a named export of
    [`server/src/utils/securityConfig.js`](server/src/utils/securityConfig.js).
  - **M5 — SQL constants are bind parameters now.** `validateAvailability` in
    `reservationsModel.js` and `findReservationOverlap` in
    `establishmentClosuresModel.js` built their overlap WHERE via template literals
    `${EARLY_CHECKIN_BLOCK_HOUR}` / `${LATE_CHECKOUT_BLOCK_HOUR}`. Runtime risk was
    nil (compile-time integers) but the pattern violated parameterization and tripped
    every SAST scan. Replaced with `?` placeholders + bind params; semantics identical.
  - **M6 — Defense-in-depth identifier validator in `dbHygiene.js`.** DDL
    interpolation (`CREATE INDEX ${name} ON ${table}(${cols})`) is unavoidable since
    SQL identifiers can't be bound. Today every value comes from the trusted
    `FK_INDEXES`/`UNIQUE_INDEXES` catalog in the same file. Added a
    `SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/` regex + `assertSafeIdentifier`
    helper called for every index/table/column name before interpolation. The migration
    now throws loudly with `Unsafe SQL ...` if any future entry doesn't match the
    expected shape — catches a future refactor that lets external input reach the
    pass before any DDL runs. Pinned by a new test (`db-hygiene.unit.test.js`) with
    15 injection payloads (`'foo; DROP TABLE x;--'`, embedded quotes, hyphens, dots,
    leading digit, over-length, non-string types) — each must throw.

### Fixed
- **`issue-letsencrypt-cert-http01.sh` — `openssl verify` post-install was missing
  `-untrusted` and triggered a false-negative on the new LE intermediates.** When a
  fullchain file is passed to `openssl verify -CAfile <bundle> <fullchain>`, openssl
  validates ONLY the leaf and looks for its issuer in the trust bundle. Since the
  leaf's issuer is an intermediate (Let's Encrypt's `YE1` introduced in late 2025),
  not a root, verify failed with `error 20: unable to get local issuer certificate`
  even when the cert was perfectly valid. The script then triggered the (correct)
  auto-recovery wipe → re-issue → install → re-verify — same wrong verify command,
  same false negative — and exit'd 1 telling the operator the cert was broken.
  Adrien's 2026-06-01 cert (chain: leaf → YE1 → ISRG Root YE → ISRG Root X2 →
  ISRG Root X1, the last of which is in every browser trust store since 2017) was
  100 % valid and Node was already serving it correctly with a green padlock in
  browsers — the script was the bug. Fix: pass the same fullchain file via
  `-untrusted` too, so openssl walks the chain (leaf → intermediates → root) before
  consulting the trust store. Verify now matches what browsers actually do.

### Added
- **Let's Encrypt cert via Freebox port-forward + HTTP-01** (`server/scripts/issue-letsencrypt-cert-http01.sh`).
  The path Adrien's prod actually uses to make `https://<your-app>.<your-domain>` reach the Pi
  with a publicly-trusted cert (no browser warning) and a hands-off auto-renewal — without
  migrating DNS hosting (Squarespace stays as registrar + DNS host). The architecture is a chain
  of three boring steps: a CNAME `guestflow → <your-freebox-dyndns>.freeboxos.com` at Squarespace, two
  Freebox port-forwards (WAN 80 → Pi:80 for ACME, WAN 443 → Pi:4000 for HTTPS), and a single
  acme.sh standalone invocation on the Pi. acme.sh's daily cron re-issues at the 60-day mark,
  briefly re-binds port 80 to answer the ACME challenge, drops the renewed fullchain into
  `~/guestflow/certs/server.{crt,key}`, and triggers `pm2 restart guestflow` via `--reloadcmd`.
  The script defensively pre-flights (cert + key file paths, root requirement for port 80,
  port-busy check via ss / netstat, FQDN format) and surfaces a self-contained troubleshooting
  cheatsheet on failure (DNS propagation, Freebox forward, ISP port-80 blocking, staging fallback).
  README §HTTPS gets a full operator walkthrough — DHCP reservation pinning the Pi at
  <your-pi-lan-ip>, the exact Freebox port-forwarding table, the `dig`-based DNS verification, and
  caveats (CNAME chain self-updates via Free's DDNS so the dynamic public IP is a non-issue;
  hostname-only access since the cert SAN is the FQDN). Complements the earlier
  `feat/prod-https-self-signed` (still ships the script + behaviour for offline / LAN-only
  deploys) and supersedes the abandoned `feat/letsencrypt-cert-via-cloudflare` branch (the
  Cloudflare migration was a heavier path Adrien chose not to take).
- **Dynamic favicon from the company logo (works in dev AND prod).** When the admin has
  uploaded a logo via Settings → *Informations sur votre activité*, the browser tab favicon
  becomes that logo on every page. Two cooperating layers:
  - **Server-side middleware** (`server/src/middleware/dynamicFavicon.js`, mounted BEFORE
    `express.static(clientBuildDir)` in `index.js`) serves the logo on `/favicon.ico` AND
    `/favicon.svg` whenever the page is served by Node — covers the production build, bookmarks,
    initial tab load, and any client that ignores JS. Path-safety pinned by 7 traversal test
    cases (`/etc/passwd`, `..`, URL-encoded payloads, etc. all caught), and transient
    `settingsModel.read()` failures (SQLITE_BUSY during a hot migration) are swallowed → the
    favicon endpoint never turns into a 500. 5-minute `Cache-Control`.
  - **Client-side hook** (`client/src/hooks/useDynamicFavicon.js` + `utils/setFavicon.js`)
    fetches `/api/settings` on AppShell mount + every user change and rewrites the document's
    `<link rel="icon">` directly. **This is what makes the favicon update in DEV** (CRA's
    :3000 dev server serves `public/favicon.ico` from disk and never proxies it to Node, so the
    server middleware can't fire there), and it also defeats the browser's aggressive favicon
    cache via a `?v=<updatedAt>` buster on the href. `SettingsPage.handleUploadLogo` /
    `handleDeleteLogo` push a new icon directly via `setFavicon` after the API resolves, so the
    tab updates the very second the upload completes — no reload needed. The setter strips
    every prior `<link rel~="icon">` so Firefox (which picks the FIRST declaration) honours the
    dynamic one, and it sets the correct `type` attribute from the extension. 23 unit tests
    across `setFavicon.test.js` (idempotency, default-restore, cache buster, MIME mapping,
    null-doc no-op, etc.) and `useDynamicFavicon.test.js` (initial fetch, no-logo restore,
    silent failure on pre-login 401, refresh on key change, stale-fetch-after-unmount guard).
  Result: drop in your logo via Settings, the tab favicon updates immediately in dev, and the
  next prod deploy serves it on `/favicon.ico` for every visitor including new tabs and
  bookmarks.
- **Self-service profile editor on `/account`** (spec `admin-account-management.md` follow-up #6).
  A new "Mes informations" card sits **above** "Mon mot de passe" and lets every authenticated
  user (admin or accountant) edit their own `firstName`, `lastName`, `companyName` and `notes`.
  Email stays locked (same rule as the admin form in edit mode). **Roles are NOT exposed
  anywhere** — neither in the UI nor accepted by the server. The new endpoint
  `PUT /api/users/me` deliberately omits both `roles` and `email` from the model call so an
  authenticated user cannot grant themselves admin via a hand-rolled payload (privilege guard,
  asserted by 3 dedicated unit tests). On a successful save the page triggers `useAuth().refresh()`
  so the sidebar + dialogs pick up the new name immediately. Field-level server errors
  (`{ field, detail }`) land under the matching input; generic errors fall to the page snackbar.
  Tests: 6 new server cases (`users-controller`), 7 new client cases (`SelfProfileSection`), and
  4 new page cases (`UserManagementPage`). Full suite green at 63 / 63 server + 37 / 37 client.

### Changed
- **Sidebar is rendered by a single code path for every role** (spec
  `admin-account-management.md` follow-up #5). The dedicated accountant branch is gone — there's
  one `NavContent` tree, and each item (top-level + every submenu child) is conditionally rendered
  via `canSeeRoute(user, path)`. Per-route allowlist lives in
  `client/src/constants/roles.js#ROUTE_ROLES` (admin everywhere; accountant only on `/comptabilite`
  + `/account`). Submenu **parents** survive iff at least one of their children is visible
  (`canSeeAnyRoute`), so an accountant sees `Suivi financier > Comptabilité` and
  `Paramètres > Gestion utilisateur` with the parent labels intact instead of a flattened
  two-item list. When the parent's own path isn't reachable (accountant on `/settings`), the row
  drops its `Link` props and only toggles the submenu — drawer-close is suppressed in that case
  so the user can still pick their authorised child. New client tests pin the accountant scope
  (8 cases on `canSeeRoute` / `canSeeAnyRoute`); a drift here will be caught before it ships.
  Resolves Adrien's "afin de ne pas dupliquer le code du menu de gauche" feedback.
- **"Gestion utilisateur" page moved under `Paramètres`** (spec
  `admin-account-management.md`). Same route `/account`, same content gating — only the sidebar
  entry-point moved: it's now a submenu of "Paramètres" alongside Logements / Options / Clients /
  Vacances scolaires / Fermetures, with `<AdminPanelSettingsIcon />`. The Paramètres submenu
  auto-opens when `/account` is the current path. For accountants, the entry is now also reachable
  via `Paramètres > Gestion utilisateur` (follow-up #5 above unified the sidebar code so the
  accountant sees the same shell with admin-only items hidden).
- **Outgoing emails sign with the SMTP sender's display name + carry an "auto-generated" notice.**
  Welcome / reset / SMTP-test bodies now end with `Ce message est généré automatiquement.` followed
  by `— {smtpFromName}` (falls back to `GuestFlow` when no name is configured). Replaces the
  previous hardcoded "— GuestFlow" trailer.
- **SMTP password input strips all whitespace before saving.** Gmail App Passwords are displayed in
  a `abcd efgh ijkl mnop` 4-by-4 format; copy-pasting them verbatim used to bounce with
  `5.7.8 Username and Password not accepted` because the transport sent the literal spaces. The
  cleanup is server-side in `settingsController.updateSettings`, transparent to the user, and only
  touches the password field. Adrien's reset / restore flow no longer needs the "tap each space"
  ritual.

### Fixed
- **`issue-letsencrypt-cert-http01.sh` (7 bugs + 1 self-recovery layer) +
  `.github/workflows/deploy.yml` (CI Node alignment + native rebuild) — everything caught
  during the 2026-05-31/06-01 prod bringup that previously needed manual workarounds on
  every run.**
  - *acme.sh installer flag dropped upstream* (`Unknown parameter: ----install-online`): the
    legacy `sh -s -- --install-online --email <addr> --home <path>` form was rejected by the
    current `get.acme.sh`. Switched to the documented key=value form
    `sh -s email=<addr>`; acme.sh now installs into `/root/.acme.sh` automatically. A
    re-anchor step picks up the actual install path so a non-standard `ACME_HOME` doesn't
    bite, and the script bails with a clear error if the binary still isn't where expected.
  - *acme.sh refusal under sudo* (`It seems that you are using sudo`): when invoked via
    `sudo ./script.sh`, `SUDO_USER` is set + `HOME` is preserved, which acme.sh treats as a
    misuse pattern and refuses to issue. The script now wipes `SUDO_USER/SUDO_UID/SUDO_GID/
    SUDO_COMMAND` and pins `HOME=/root` immediately before the `--issue` call — the
    pre-flight `id -u` check already guarantees we're effectively root.
  - *Cert installed where Node doesn't read it* (the silent killer): `CERTS_DIR` defaulted
    to `$HOME/guestflow/certs`. Under sudo that's `/root/guestflow/certs/`, while PM2 runs
    Node as the calling user (e.g. `pi`) and reads `/home/pi/guestflow/certs/server.{crt,key}`.
    Result: the cert was issued and installed perfectly, but Node kept serving the old
    self-signed one because the two paths never intersected. The script now derives
    `CERTS_DIR` from `$SUDO_USER`'s home (or honours an explicit `CERTS_DIR=...` env
    override), and the `chown` step targets `$SUDO_USER:$SUDO_USER` instead of the
    previously-hardcoded `adrien` — works on Adrien's Pi where the deploy user is `pi`. As
    a side-effect, the daily renewal cron now writes to the same path because acme.sh
    persists `--install-cert` targets in its per-domain conf.
  - *`--reloadcmd` ran as root, didn't reach the `pi`-owned PM2 daemon* (caught right after
    the first prod-cert install: cert file on disk was the real Let's Encrypt one, but
    `openssl s_client -connect localhost:4000` kept showing the previous staging cert). The
    reloadcmd was `pm2 restart guestflow --update-env >/dev/null 2>&1 || true` — invoked
    from acme.sh's root context, root's PM2 doesn't know the `guestflow` process and the
    call silently no-op'd; the `|| true` then masked the failure. The script now wraps the
    reload in `sudo -u $CERT_OWNER` when CERT_OWNER is non-root, and removes the noise
    suppression so any failure surfaces in acme.sh's output (and in cron emails at renewal
    time). acme.sh persists `--reloadcmd` per-domain, so re-running `--install-cert` (which
    this script does on every invocation) updates the value for all future renewals.
  - *Staging cert silently re-installed when re-running against prod* (the trap that left
    Adrien's Node serving `O=Let's Encrypt, CN=YE2` — a staging intermediate — even after
    a prod re-issue with `--force`): acme.sh keeps per-domain state in
    `<acme_home>/<domain>_ecc/` regardless of CA endpoint. When you iterate with
    `--staging` then switch to prod, the stale staging leaf sometimes survives
    `--install-cert` and Node ends up serving it. Browsers reject; `openssl verify` fails
    with `error 20 at 0 depth lookup: unable to get local issuer certificate`. The script
    now reads `Le_API` from the per-domain conf BEFORE the issue step; if it points at
    `acme-staging-v02` while the script is about to issue against `acme-v02` (or vice
    versa), the per-domain dir is wiped via `--remove -d <host> --ecc` + `rm -rf`. The
    acme.sh install and the account stay intact — only the per-domain cert tracking is
    reset. Idempotent: a same-endpoint re-run does nothing.
  - *No post-install sanity check, so a bad install was silent*: after `--install-cert`
    the script now prints `subject / issuer / dates` of the installed cert and runs
    `openssl verify -CAfile <system bundle>` against the leaf. System CA bundle is
    auto-detected across the three common paths (Debian, RHEL, Alpine). For a staging
    cert (intermediates not in any OS trust store), verification failure is tolerated.
  - *Auto-recovery when verification of a prod cert fails*: in Adrien's case the staging
    cert was installed even after a clean prod re-issue (acme.sh's `--install-cert`
    appears to occasionally copy the prior leaf instead of the freshly-downloaded one;
    exact mechanism unclear, possibly state cache or partial write). The script now
    treats verification failure on a prod request as a recoverable error: it wipes the
    per-domain state (`acme.sh --remove -d <host> --ecc` + `rm -rf <domain_dir>`),
    re-runs `--issue` from a clean conf, re-runs `--install-cert`, and re-verifies.
    Exactly one retry. If the second verify still fails the script `exit 1`s with a
    manual inspection cheatsheet (`openssl x509 -text`, `cat <domain>.conf`). No human
    in the loop in the common-but-broken case.
  - *Staging-vs-prod URL substring trap in the transition detection*: the previous
    pattern check used `grep -q "acme-v02"` which silently matches `acme-staging-v02`
    too (substring) — the detection misfired by treating staging as "compatible with the
    prod request". Replaced with a `grep -q "staging"` boolean compared against the
    `$STAGING` flag. Now the detection fires exactly when the previous CA endpoint and
    the current request differ.
- **`.github/workflows/deploy.yml` — CI Node version aligned with the Pi's runtime + force
  rebuild of native modules after install.** Every release deploy was leaving the
  `better-sqlite3` native compiled for the wrong Node ABI, then PM2 silently crashed on
  next restart (`ERR_DLOPEN_FAILED`, `NODE_MODULE_VERSION 127 ... 137`). Two compounding
  causes:
  - `actions/setup-node@v4` was pinned to `node-version: '22'`, but the Pi's system Node
    (which the PM2 daemon runs under) had been bumped by apt unattended-upgrades to v24.
    The deploy built `better-sqlite3` against the v22 ABI; PM2 spawned Node v24 → load
    refused. Pin bumped to `'24'` to match the current system. Comment added explaining
    that bumping the Pi's Node requires bumping this pin in the same PR.
  - Even with the right pin, `npm ci` happily downloads `better-sqlite3`'s prebuilt
    binaries from GitHub releases (matching the pinned major), which historically have
    drifted from the running Node's exact ABI. Added an explicit `npm rebuild
    --build-from-source better-sqlite3` step right after `npm ci` and a `require()` smoke
    test — a broken rebuild fails the deploy loudly here, rather than later via the PM2
    errored / crash-loop state. Plus a `Sanity-check Node + npm versions` step at the top
    that prints `node -v`, `npm -v`, `NODE_MODULE_VERSION` and warns if the existing PM2
    daemon's Node major differs from the runner's — surfaces drift in the deploy log.
  Manual recovery on a Pi that hit the bad state: `cd ~/guestflow/current/server && npm
  rebuild --build-from-source better-sqlite3 && pm2 restart guestflow --update-env`.
  README §HTTPS — *Real Let's Encrypt cert via Freebox port-forward* — gains the operator
  walkthrough split into staging-first + `--force` for prod, plus a *Troubleshooting* block
  covering the four pitfalls actually hit on 2026-05-31: the `.com` vs `.fr` DDNS suffix
  (Free's Freebox DDNS lives under `.fr` — Squarespace CNAMEs pointing at
  `<your-freebox-dyndns>.freeboxos.com` return NXDOMAIN), the cached-NXDOMAIN behavior on
  carrier resolvers (browser sees `DNS_PROBE_FINISHED_BAD_CONFIG` while `dig @8.8.8.8`
  resolves fine), the sudo-HOME / CERTS_DIR mismatch (and the `openssl s_client` one-liner
  to verify which cert Node is **actually** serving on `localhost:4000`), and the
  unrelated-but-co-occurring `NODE_MODULE_VERSION 127 ... 137` PM2 crash after a Pi-side
  Node bump (fix: `cd ~/guestflow/current/server && npm rebuild better-sqlite3 && pm2
  restart guestflow --update-env`).

### Added
- **Test coverage for the Gestion utilisateur feature** (Adrien feedback 2026-05-30):
  - **Server** (`server/src/tests/`): new `settings-controller-smtp-password.unit.test.js`
    (7 cases on the password whitespace strip — Gmail 4×4, tabs/newlines, no-whitespace
    pass-through, empty/null clear, absent preserve, whitespace-only → clear); extended
    `email-templates.unit.test.js` (every template signs with `fromName` + carries the
    auto-generated notice + falls back to GuestFlow); extended `users-controller.unit.test.js`
    (`fromName` flows from `settingsModel.decryptedSmtpSettings()` to the welcome + reset
    templates). All M3 server suites: 88 / 88 green.
  - **Client** (`client/src/`): new Jest + RTL tests — `constants/__tests__/roles.test.js`
    (6 cases on `ROLES` / `roleLabel` / `userHasRole` including the legacy `role` string
    back-compat shim and array-wins-over-string precedence); `pages/__tests__/UserManagementPage.test.js`
    (6 cases on role-gated section visibility, listUsers fetch gating, multi-role admin+accountant,
    null user, listUsers failure surfaced as Alert); `components/__tests__/AccountFormDialog.test.js`
    (5 cases on email lock in edit, self-protection of own admin role, fieldErrors landing,
    submit payload shape). 17 / 17 client tests green.
- **Admin account management — unified "Gestion utilisateur" page** (spec
  `admin-account-management.md`). One page at `/account` (sidebar entry "Gestion utilisateur",
  available to every authenticated role). Top section "Mon mot de passe" lets the current user
  change their own password (same forced-first-login redirect-to-login flow as before). For admins,
  a second section "Gestion des comptes" lists every user with full CRUD: create with first/last
  name, email, multi-role (admin + accountant via a multi-select), optional company + free-form
  note; edit; reset password; soft delete (deactivate) and hard delete (only when the user has
  never logged in). Temporary passwords are generated server-side and **emailed via SMTP** — never
  displayed or logged. The flow uses an "email first, persist second" ordering so a failed email
  never leaves a half-created account behind. Self-protection guards on both client and server:
  cannot delete self, cannot remove own `admin` role, cannot reset own password from the admin
  table (use the "Mon mot de passe" section on the same page). A "last admin" guard rejects any
  action that would leave zero active admins (`400 LAST_ADMIN`). The legacy paths
  `/settings/password` and `/comptes` redirect to `/account`; the `Paramètres > Mot de passe`
  submenu and the standalone `Comptes` sidebar entry have been removed.
- **Forced first-login re-authentication.** When a user changes the temporary password they
  received by email, the server now **destroys the session** and the client redirects to
  `/login?reason=password-changed` with a one-shot snackbar. Voluntary password changes from
  `/settings/password` (when `mustChangePassword` was already cleared) keep the session active —
  unchanged UX.
- **SMTP configuration in `/parametres`** (`Envoi d'emails (SMTP)` card). Fields: host, port,
  STARTTLS/TLS implicit, username, password (encrypted at rest with AES-256-GCM, masked on read
  via `passwordSet: boolean`), `fromEmail`, `fromName`, `publicUrl` (used in the welcome email).
  "Envoyer un mail de test" button hits `POST /api/settings/smtp-test` which dispatches an
  "Email de test GuestFlow" to the current admin's address; the response detail surfaces transport
  errors verbatim for diagnosing creds.
- **Multi-role users.** The single `users.role` column is replaced by a `user_roles(userId, role)`
  join table with `ON DELETE CASCADE`. A user holds an array `roles` everywhere (safe shape,
  session, JWT-like payload). The middleware (`enforceRoleAccess`) and the client now read from
  this array; combined `admin + accountant` always wins as admin. `server/src/constants/roles.js`
  is the new single source of truth (mirrored client-side as `client/src/constants/roles.js`).
- **Shared `MonthYearPicker` component** (`client/src/components/MonthYearPicker.js`). Single source
  of truth for the month + year selection card, with optional `description` caption,
  `maxMonth = 'YYYY-MM'` to disable forward months, and `helperText` under the Mois field. Exposes
  `toYearMonth({month,year})` / `fromYearMonth('YYYY-MM')` helpers so callers that hit endpoints
  expecting the string format (tourist tax) can convert without owning the logic. Now used by
  `/comptabilite` and `/finance/tourist-tax` — both pages look and read the same.
- **Per-platform tourist tax collection** (spec `per-platform-tourist-tax-collection.md`).
  Each iCal source now carries a **`collectsTouristTax`** flag (default `1`, mirrors the previous
  hardcoded "non-direct = platform collects" rule). The pricing engine resolves it per reservation:
  direct → owner always collects; non-direct → look up the property's iCal source for that platform
  key (case-insensitive), follow its flag; no matching source → default to "collects" (legacy
  safe). The **Suivi taxe de séjour** extraction now lists direct bookings **plus** non-direct
  bookings whose platform was explicitly switched to "owner collects" — coherent with what's
  charged on the quote. New UI: a `Switch` "La plateforme collecte la taxe de séjour" under the
  iCal source form on the property page, plus a "Taxe collectée" column (`Plateforme` / `Vous`
  chip) in the sources table. Unit tests: `pricing-tourist-tax-platform-collection` (6 cases).
  Full server suite green at 446.
- **Reservation: 3rd payment slot "Complément à percevoir"** (spec
  `accountant-accounting-export.md`, rule 28). When the deposit and the balance are marked paid and
  the total stay TTC has *since* grown — typical case: options or extras added after the payments
  were recorded — the pricing engine now surfaces the leftover as `complementAmount =
  max(0, totalStayPrice − depositAmount − balanceAmount)`. The FinanceSection renders a 3rd block
  (orange-tinted) under Solde with a single "Marquer complément payé" button + a "Payé le" date,
  visible **only** when the complement is > 0. Once paid the amount is frozen in the DB like
  deposit/balance — the engine never erodes received money. Typically settled at end of stay for
  on-site extras. The accounting export treats it as a 3rd encaissement type alongside deposit and
  balance (same balanced double-entry shape, dated at `complementPaidDate`). Migration backfills
  the column on existing fully-paid reservations so any silent gap (e.g. production res #12087:
  240 € unbilled) becomes immediately visible. Unit tests: `pricing-complement` (7). Full suite
  green at 440. Also fixes a quiet inaccuracy: the export now pro-rates against `totalStayPrice`
  (= finalPrice + tourist tax) instead of `finalPrice`, so D + B + C = 100 % exactly.
- **Accountant access + monthly accounting CSV export** (spec
  `accountant-accounting-export.md`, PR 3 — closes the feature):
  - New **`accountant`** user role and a dedicated **`/comptabilite`** page (nested under "Suivi
    financier" in the admin sidebar). The accountant logs in, picks a month + year, downloads the
    sales CSV, and changes their own password — and can do **nothing else** (read-only by construction).
  - **Sales CSV** (`GET /api/accounting/sales.csv?month=&year=`) — one row per double-entry journal
    line, balanced: client auxiliary account `C<NAME>` debited TTC, revenue accounts (`70600000` /
    `70600010` / `70601000`) credited HT pro-rated per encaissement, VAT accounts (`44571100` /
    `44571200`) credited per rate. One entry **per encaissement** (deposit or balance) whose
    `depositPaidDate` / `balancePaidDate` falls in the month, so a reservation paid across two months
    appears in both. Caution and tourist tax are excluded; `kind='devis'` rows never exported.
    Trailing info columns (`Plateforme`, `Prix payé client`, `Commission`) carry the platform data on
    the debit row only. **Format:** `;` separator, UTF-8 BOM, comma decimals, FR-Excel friendly.
  - **Platform commissions preview** (`GET /api/accounting/platforms?month=&year=`) — JSON used by
    the page table.
  - **Turnover basis = net** (the owner-received `finalPrice`) — chosen as the simple default; the
    brut + commission appear only in info columns. One-line switch in
    `constants/accounting.js::RECOGNISE_REVENUE_ON` when the accountant's example CSV arrives.
  - **Role enforcement** — new `middleware/enforceRoleAccess.js` (fail-closed): accountants reach
    only `GET /api/accounting/*` + self routes (`me`, `logout`, `change-password`, `version`); every
    other endpoint returns **`403 FORBIDDEN_ROLE`**. Admin keeps full access.
  - **Admin can create / reset the accountant** from **Paramètres → Accès comptable** (new
    `SettingsAccountantAccessSection`). The accountant must change the temporary password on first
    login (reuses `mustChangePassword`).
  - **Client account format:** `C` + first 6 chars of the last name, uppercased, accent-stripped,
    padded with `X` if shorter — a common French convention. Trivially tunable in `accounting.js`.
  - **Visual journal preview** above the platforms table — one card per encaissement mirroring
    exactly what will be in the CSV, with the per-line account number paired with its human label
    (`Location gîte`, `TVA 10 %`, `Compte client`…), coloured by type (client/amber, revenue/green,
    VAT/blue), balanced badge per card and `Tout équilibré` chip in the header. Backed by a new
    `GET /api/accounting/sales` JSON endpoint (strict mirror of the CSV via
    `buildStructuredEntries`). For **admin only**, the client name is a link to the reservation file
    (accountant sees plain text).
  - **Dedicated change-password page** at `/settings/password`, accessible to every authenticated
    role (admin and accountant). Replaces the previous duplicate "Sécurité" cards on `SettingsPage`
    and `AccountingPage`. Admin sees a "Mot de passe" sub-item at the bottom of the Paramètres
    group; accountant has a minimal sidebar (Comptabilité, Mot de passe, Se déconnecter) and is
    client-side-redirected to `/comptabilite` from anywhere outside the two allowed paths.
  - New files: `constants/accounting.js`, `middleware/enforceRoleAccess.js`, `models/accountingModel.js`,
    `models/usersModel.js` (extended), `controllers/{accountingController, usersController}.js`,
    `routes/{accounting, users}.js`, `utils/{csv, accountingExport}.js`,
    `pages/AccountingPage.js`, `pages/ChangePasswordPage.js`,
    `components/SettingsAccountantAccessSection.js`.
  - Unit tests: `csv` (6), `accounting-export` (19), `enforce-role-access` (8), `users-model-admin` (7) —
    full server suite green (433).
- **Reservation payment dates + platform gross / commission** (spec
  `accountant-accounting-export.md`, PR 2): each reservation now records the **real encaissement date**
  for the deposit and the balance (`depositPaidDate`, `balancePaidDate`) — defaulted to today when the
  user marks paid, editable in the FinanceSection ("Payé le"), cleared on un-pay. For
  platform-sourced bookings, a new **"Prix payé par le client"** field (`clientGrossAmount`) captures
  the TTC amount the guest paid the platform; the **commission** is derived (`gross − finalPrice`,
  clamped at 0) and served alongside reservations as `commissionAmount`. Both the gross field and the
  commission caption are **hidden** for direct bookings. The write boundary rejects a gross below the
  net (`400 GROSS_BELOW_NET`). Unit tests: `client-gross-amount` (7), `reservations-commission` (7).
  Foundation for the monthly accounting CSV (PR 3).
- **iCal import — cross-platform de-duplication** (`propertyIcalModel.syncSource`): the same booking
  appearing in two platforms' feeds (same dates + guest name, different source + UID) now maps to the one
  existing reservation instead of creating a duplicate. Stale removal is cross-source-safe — a shared
  booking is only deleted once **every** feed drops it. Combined with the existing UID / per-source-fallback
  matching and the `icalSyncLocked` guard, a re-import never duplicates or overwrites a (user-modified)
  reservation. New `reservations.icalOriginalSummary` column stores the authoritative original guest name
  at import time (hidden from the frontend), so the date-scan legacy match stays reliable even after the
  user renames the client or edits the notes — instead of re-parsing the fragile `Résumé:` notes line.
  Guards: `property-ical-dedup.unit.test.js` (7).
  - **Migration:** `ALTER TABLE reservations ADD COLUMN icalOriginalSummary TEXT`; existing iCal rows are
    best-effort backfilled from their notes' `Résumé:` line.
- **Server-owned payment status** — new `utils/paymentStatus.js` (`computePaymentStatus`) is the single
  authority for `remainingDue` / `paymentComplete` / `depositOverdue` / `balanceOverdue` / `overdueAmount` /
  `oldestDueDate`, replacing two divergent client `getRemainingDue` copies. New
  `GET /api/finance/operational` returns the whole "Suivi opérationnel" section ready to render
  (overdue sorted + count + total, pending list, flat upcoming with `nights`). Reservation list + detail
  payloads now carry `remainingDue` + `paymentComplete`. Unit tests: `payment-status` (8), `finance-model` (4).
- **Server-side French public holidays** — new `GET /api/public-holidays?years=2025,2026` endpoint
  (`utils/frenchHolidays.js` Easter computation → `[{ date, label }]`, validated `?years=`, auth-gated).
  The calendar and the pricing-seasons page now **fetch** their "férié" markers instead of computing
  them client-side. Unit tests: `french-holidays` (5).
- **Show/hide password toggle** — new reusable `PasswordField` component (MUI TextField + eye
  adornment) used on the login screen and the change-password form (forced first-login change +
  Settings). Lets the user verify what they type, which notably surfaces browser-autofilled values.
- **Admin account recovery** — `cd server && npm run reset-admin` restores the default admin
  (`admin@guestflow.local` / `ChangeMe!2026`) with a forced password change and clears sessions, for
  when the password is lost (no manual DB editing). Backed by `usersModel.resetAdminToDefault()`
  (recreates the admin if missing) + unit tests. The admin password already persists across restarts
  (the seed only runs when the `users` table is empty).
- **Security hardening — headers, rate limiting, uploads, validation** (Bloc S PR 2, spec
  `security-hardening.md`):
  - **HTTP security headers** via `helmet`, including a CSP tuned for the SPA
    (`script-src 'self'` thanks to `INLINE_RUNTIME_CHUNK=false`; `style-src`/`font-src` allow MUI inline
    styles + Google Fonts; `img-src` allows uploaded images). Verified against a production build.
  - **Rate limiting** (`express-rate-limit`): login 10 failed/15 min/IP, global API 3000/15 min/IP
    (`429`), env-configurable; public iCal export exempt. Replaces PR 1's minimal throttle.
  - **Upload hardening**: document upload gains a 10 MB limit + extension/MIME allowlist; logo extension
    is whitelisted; file deletion is path-contained (`safeUploadPath`). New pure util `utils/uploadSafety.js`.
  - **Money/percentage validation at write boundaries**: reservations `POST`/`PUT`/`PATCH payment` and
    devis `POST`/`PUT` reject negative/NaN/out-of-range values (`400`) before any DB write
    (resourceBookings computes its price server-side, nothing to validate).
  - New deps: `helmet`, `express-rate-limit`. Unit tests: `upload-safety` (6). Full suite green (247).
- **Security foundation — authentication + credential encryption** (Bloc S PR 1, spec
  `security-auth-encryption.md`):
  - **All `/api` routes now require a logged-in session** (fail-closed in `index.js`), except
    `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, the public
    `GET /api/ical/export/:token` feed, and `GET /api/version`.
  - Server-side sessions (`express-session` + `better-sqlite3-session-store`) via an httpOnly,
    `sameSite=lax`, prod-`secure` cookie (30-day sliding); password hashing with `scrypt` (no new crypto
    dep). New `users` table (multi-user-ready, `role` default `admin`).
  - **Default admin + forced first-login password change**: seeded `admin@guestflow.local` /
    `ChangeMe!2026` with `mustChangePassword`; the default password only opens the "set password" screen
    (other routes return `403 PASSWORD_CHANGE_REQUIRED`). Documented in the README.
  - **Google credentials encrypted at rest** (AES-256-GCM) in `settingsModel`, key auto-generated into
    `server/.env.local`; transparent one-time boot migration of legacy cleartext values.
  - Client: `LoginPage`, `useAuth` context (gates the app), forced password-change screen, "Se
    déconnecter" in the sidebar, "Sécurité → Changer le mot de passe" in Settings; `api.js` sends the
    session cookie and redirects to login on 401. Minimal login throttle (full rate limiting in PR 2).
  - New server files: `utils/encryption.js`, `utils/localEnv.js`, `utils/passwordHash.js`,
    `models/usersModel.js`, `middleware/requireAuth.js`, `controllers/authController.js`,
    `routes/auth.js`, `constants/authDefaults.js`.
  - Unit tests (+28): `encryption`, `password-hash`, `users-model`, `require-auth`, `auth-controller`,
    `settings-model-encryption`. Full suite green (241).
- **Pricing engine — server-authoritative, thin client** (Bloc 2, spec `pricing-engine-thin-client.md`):
  - Quote now returns `engineFinalPrice` (engine-computed price ignoring any manual override) and
    `priceOverridden`, so the UI shows the engine price struck through with the manual price in green.
    The manual price (`customPrice`) overrides the **accommodation** amount and drives the accommodation
    VAT base; options/resources add on top.
  - New `server/src/utils/financeValidation.js` (`validateMoneyAmount`, `validatePercentage`,
    `validateFinanceInputs`) enforced at `POST /api/reservations/calculate-price` (rejects negative/NaN
    amounts and out-of-range percentages with `400 NEGATIVE_AMOUNT|NOT_A_NUMBER|INVALID_PERCENTAGE`).
  - Option/resource summary lines are returned in display order (by title / name) instead of insertion
    order; custom options keep their input order last.
  - Unit tests: `finance-validation.unit.test.js` (6 cases), `pricing-offered-engine.unit.test.js`
    (6 cases). Full suite green (213).
- **School holidays** redesigned with auto-sync + Gantt timeline (spec `school-holidays.md`):
  - Page `/school-holidays` rebuilt as a **Gantt-style annual timeline**: one card per French school year (Sept → Aug), 12-month axis, 3 stacked zone lanes (A/B/C) with colored bands per period. Click a band → edit dialog.
  - **Auto-sync from `data.education.gouv.fr`** ([fr-en-calendrier-scolaire](https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/)) via Node's built-in `fetch` (no new dependency). User-configurable interval (default 60 d, range 1–365) and horizon (default 24 months, range 1–60). Scheduling is a 1-hour tick that re-reads the config from DB on every fire — settings changes take effect without a restart.
  - **Lock semantics** (per user choice "Manuel verrouille auto"): editing an auto-imported row sets `isLocked = 1`, the sync engine then skips it. A "Réactiver la mise à jour automatique" button in the edit dialog flips it back.
  - **Manual sync trigger** + **settings gear** on the page (banner + `PageActionBar` icon).
  - Full MVC backend: `routes/schoolHolidays.js` (thin), `controllers/schoolHolidaysController.js`, `models/schoolHolidaysModel.js` (factory), `utils/schoolHolidaysValidation.js`, `utils/schoolHolidaysSync.js`, `utils/educationGouvClient.js`.
  - New client components: `SchoolHolidaysTimeline`, `SchoolYearStrip`, `SchoolHolidayBand`, `SchoolHolidaysSyncBanner`, `SchoolHolidaysSyncSettingsDialog`. New `client/src/constants/schoolHolidayZoneColors.js` is the single source of truth for the zone color palette. New util `client/src/utils/schoolYear.js` groups periods by school year.
  - Unit tests: `school-holidays-validation.unit.test.js` (14 cases), `school-holidays-model.unit.test.js` (15 cases), `school-holidays-sync.unit.test.js` (10 cases) — all green.
- **Establishment closures** feature — revives orphan code into a working flow:
  - Top-level sidebar entry "Fermetures" → CRUD page at `/establishment-closures` built around the shared `PageActionBar` + `TableCard` + `FormDialog`.
  - Per-property + global scoping (`propertyId IS NULL` = blocks all logements, `propertyId = X` = blocks only logement X).
  - Server-side overlap detection: reservations conflicting with a closure return `409 CLOSURE_COVERS_DATE`; competing closures return `409 CLOSURE_OVERLAP`.
  - Calendar visualization: closed days render as gray-striped bands with the closure label, tooltip showing `<label> — du <start> au <end>`. Drag-create on closed days is auto-blocked because `getOccupiedDates` now appends closure dates.
  - Full MVC backend: `routes/establishmentClosures.js` (thin), `controllers/establishmentClosuresController.js`, `models/establishmentClosuresModel.js` (factory), `utils/establishmentClosuresValidation.js`.
  - New schema: `establishment_closures` table + `idx_establishment_closures_propertyId_dates` (added to the DB-hygiene index catalog).
  - New client util `utils/closureCalendar.js` (`expandClosuresToDates`, `getClosureForDate`).
  - Unit tests: `establishment-closures-validation.unit.test.js` (6 cases), `establishment-closures-model.unit.test.js` (~15 cases covering global/per-property semantics, night-block expansion, excludeId on edit).
- **DB Hygiene pass** (Bloc 0) — `server/src/utils/dbHygiene.js`:
  - 30 foreign-key indexes (`CREATE INDEX IF NOT EXISTS`) covering every FK column that is filtered or joined in routes — eliminates table scans on `WHERE propertyId = ?`, `WHERE reservationId = ?`, etc.
  - 2 iCal anti-overbooking lookup indexes: `idx_reservations_ical_source(sourceIcalSourceId, sourceIcalEventUid)` (primary sync lookup) and `idx_ical_import_events_reservationId` (reverse lookup on reservation deletion). Documented in `specs/db-hygiene-quick-wins.md` §1.1.
  - 2 unique indexes blocking duplicates at the DB level: `uniq_resource_bookings_slot(resourceId, date, startTime, endTime)` and `uniq_ical_sources_property_platform(propertyId, platformKey)`. Pre-check warns and skips the index when existing data already contains duplicates (no breakage).
- Unit tests: `server/src/tests/db-hygiene.unit.test.js` (13 cases covering index presence, unique-constraint rejection, duplicate pre-check warning path, FK-blocked drop graceful handling, query-planner usage).
- Shared sticky `PageActionBar` component used by every page (built-in Save + Cancel + `actionsBefore` / `actionsAfter` slots, icon-only with French tooltips, bordered IconButton style matching the legacy ReservationPage bar).
- Generic UI components: `LogoUpload`, `MaskedTextField`, `HelpedTextField`, `StatusBadge`, `StatusCard`, `SummaryItem`.
- `useDirtyFormGuard` hook encapsulating dirty-state detection + `beforeunload` + `popstate` + `window.__guestflowBeforeNavigate` integration.
- Settings page (Paramètres) redesign — three section cards (Société + Devis + Google Agenda) under the shared `PageActionBar`, humanized French vocabulary and helper texts everywhere, server-side validation for every critical field.
- "Tester la synchronisation" action on the Google Agenda section + `POST /api/google-calendar/test-connection` endpoint with friendly French error mapping (NOT_CONFIGURED / INVALID_CREDENTIALS / FORBIDDEN / CALENDAR_NOT_FOUND / UNKNOWN).
- Server-side validators (`utils/settingsValidation.js`): email, SIRET (14 digits, whitespace-tolerant), TVA intracommunautaire, IBAN (mod-97), BIC, PEM (permissive — accepts RSA, EC, PKCS8), quote validity days.
- Unit tests: `settings-validation.unit.test.js`, `settings-response.unit.test.js`, `settings-model.unit.test.js`, `google-calendar-test-connection.unit.test.js` (44 new test cases, all passing).

### Changed
- **VAT — two global rates instead of three per-property** (spec `accountant-accounting-export.md`, PR 1):
  VAT is now configured by two app-wide rates in **Paramètres → Taux de TVA** — **accommodation**
  (`vatRateAccommodation`, default 10 %) and **standard** (`vatRateStandard`, default 20 %, used by
  options, custom options and resources). The pricing engine, the reservation/devis quote, the devis PDF
  and the reservation TVA summary read these globals; the per-property `vatPercentage*` columns have
  been **dropped** entirely (not just dormant). TTC totals are unchanged (VAT is extracted from TTC).
  New unit tests: `pricing-vat-two-rates` (5).
- **Integrations — MVC extraction** (Bloc 6, spec `integrations-mvc.md`): `routes/ical.js`,
  `googleCalendar.js`, `options.js`, `calendarNotes.js` become thin routes over controllers + models.
  The iCal token lifecycle + `.ics` export move out of `database.js` into `icalModel`; the Google event
  builders → `utils/googleCalendarEvents.js` (pure) with the reservations+options read in
  `googleCalendarModel`; options + calendar-notes get their own model/controller. No API/UX change. New
  unit tests (ical-model, options-model, calendar-notes-model); suite green (350).
- **Devis ↔ Reservation table fusion** (spec `devis-reservation-fusion.md`): devis are now rows in the
  unified `reservations` table (`kind='devis'`), their lines in the `reservation_*` children — the parallel
  `devis_*` tables are gone. `devisModel` reads/writes `reservations WHERE kind='devis'` (status stored as
  `devisStatus`, aliased back to `status` so the devis API/PDF/convert are unchanged). Every reservation
  read (occupancy, availability, blocked-night/cleaning, baby beds, resource availability, finance
  summary/projection/operational/tourist-tax, Google Calendar push, client delete-impact/orphan cleanup)
  now filters `kind='reservation'`, so a devis never blocks a date or counts as revenue. No API/UX change.
- **Properties — MVC extraction** (spec `properties-mvc.md`): `routes/properties.js` (**1260 LOC**, the
  last CRITICAL monolith) becomes a thin route over `propertiesController` + `propertyIcalController` over
  `propertiesModel` (CRUD + enriched detail + pricing rules/apply-to + documents + options + platform
  colours) and `propertyIcalModel` (sources CRUD + the anti-overbooking **sync engine moved verbatim**).
  Pure iCal parsing → `utils/icalParser.js`; upload plumbing → `utils/propertyUploads.js`. The iCal
  source **status-update was triplicated** (the `/sync` route, `/sync-all`, and `scheduledTasks`) and is
  now one `syncSourceAndRecord` method. API contract, payloads and behaviour unchanged; no schema change.
  New tests: `property-ical-sync` (7, anti-overbooking) + `properties-model` (7); migrated
  `properties-ical` to `utils/icalParser`. Server suite **346** green.
- **Finance & Dashboard — server-owned money, MVC, render-only pages** (Bloc 5, spec
  `finance-dashboard-thin.md`): `routes/finance.js` (403 LOC) is now a thin route over `financeController`
  + `financeModel`, with pure helpers in `utils/financeCalcs.js`. All payment math + overdue derivation +
  aggregation + upcoming grouping moved server-side. `FinancePage` and `Dashboard` are **render-only** —
  the two duplicated `getRemainingDue` implementations, the overdue `map/filter/sort/reduce`, the
  upcoming-by-property grouping and the inline `nights`/`remainingDue` math are gone; both pages read
  server fields. `/summary` reservations are enriched with `remainingDue` + overdue flags. No schema change.
- **CalendarPage — structural decomposition** (Bloc 3, spec `calendar-page-decomposition.md`):
  `CalendarPage.js` drops from **1255 → ~430 LOC**, becoming a thin orchestrator (data loading + drag
  selection + wiring). The intricate rendering moves **verbatim** into focused, page-specific pieces:
  `utils/calendarVisuals.js` (pure date/%/colour/label helpers, unit-tested), `hooks/useInfiniteMonthScroll.js`
  (months list + scroll/preload/focus machinery), and components `CalendarToolbar`, `CalendarDayCell`
  (the occupancy gradients + click-zone hit-testing), `CalendarMonthGrid` (sticky header + cells→rows
  assembly), `CalendarNoteDialog`. **No behaviour or visual change** (the pricing engine was already
  removed with the dead reservation dialog — this is a readability refactor). Verified in-browser
  (gradients, closures, holidays, 0 console errors) + clean `CI=true` build.
- **Devis — MVC refactor + PDF service extraction** (Bloc 4, spec `devis.md`): `routes/devis.js` (1543 LOC)
  is now a thin route over `devisController` + `devisModel` (CRUD with a single shared persist helper,
  enrich, payment schedule, history/audit, both convert flows). The ~574-LOC inline `pdfkit` generator is
  extracted **verbatim** into `utils/devisPdf.js` (`generateDevisPdf(devis, settings) → Buffer`); shared
  money/date/format helpers moved to `utils/devisHelpers.js`. Pricing stays in the shared engine; no schema
  change; the API contract is unchanged and the PDF layout is preserved **except one deliberate footer fix**
  (see Fixed). New unit tests, including money-critical create/update persistence + the audit fix
  (`devis-model-create.unit.test.js`); server suite green (315). The `devis_*`/`reservation_*` table fusion
  remains a deferred follow-up.
- **Resources — MVC refactor + applicability pivot + safe delete** (Bloc 1, spec `resources.md`):
  `routes/resources.js` and `routes/resourceBookings.js` are now thin routes over
  `resourcesController`/`resourcesModel` and `resourceBookingsController`/`resourceBookingsModel` (price
  resolution, availability, slot-conflict and the server-computed booking price now live in models).
  Resource↔logement applicability is normalized into a **`resource_properties` pivot** (mirrors
  `property_options`); the API still exposes `propertyIds` arrays, and `utils/pricing.js`, the baby-bed
  availability and the baby-bed seed all read the pivot. Resource writes are validated (`400`). Deleting a
  resource that is used by reservations or bookings now asks for confirmation stating the impact
  (`409 RESOURCE_IN_USE` + `?force`). New unit tests; full server suite 297.
- **Clients — MVC refactor + single phone** (Bloc 1, spec `clients.md`): `routes/clients.js` is now a thin
  route over `clientsController` + `clientsModel` (reusing `clientValidation`). A client now has a single
  `phone` (the multi-number list is gone — see Migration); the client form shows one Téléphone field.
  The deletion-impact endpoint is server-shaped (reservations sorted + `nights`) and now also surfaces the
  **devis** that the cascade will delete — so a client with only devis is no longer deleted silently, and
  the delete dialog lists both reservations and devis. The devis PDF reads the single `client.phone`.
  New unit tests (model, controller, migration); server suite green (274).
- **Devis editor — accept-to-convert flow + "Actualiser tarifs"** (spec `devis-accept-to-reservation.md`):
  removed the standalone "Passer en réservation" action; converting a devis to a reservation now happens
  by setting its status to **Accepté** in the dropdown, which asks for confirmation before, on confirm,
  **saving the devis, converting it into a persisted reservation, and opening that reservation** —
  whose "Annuler"/retour goes back to the **calendar centered on it** (`?from=/calendar`). The Finance
  section's **"Actualiser tarifs"** button is now also available in devis mode (recompute with current
  rates + clear any manual price).
- **ReservationPage form split into section components via a form context** (Bloc 3 slice 3c-3, spec
  `reservation-form-sections.md`) — the long left-column form JSX is decomposed into focused, feature-local
  components under `client/src/components/reservation/`: `StaySection`, `GuestsBedsSection`, `ExtrasSection`
  and `FinanceSection` (Client / Canal / Notes kept inline). A new `ReservationFormContext` +
  `useReservationForm()` hook exposes the form bundle (state, derived capacity/pricing values, handlers,
  catalogs, flags) so the sections consume what they need with **no prop-drilling**. ReservationPage keeps
  owning all state, the pricing effect and every handler — it just assembles them into one context value
  and renders `<ReservationFormProvider>…<StaySection/>…`. No behavior or visual change. Added React
  Testing Library + `setupTests.js`; **19 component tests** (one suite per section + a context-guard test)
  pin each feature against regressions. Verified by a clean `CI=true` build + in-browser (dates → quote
  refreshes to 740.88€ total, 0 app console errors).
- **PricingSummary extracted from ReservationPage** (Bloc 3 slice 3c-2, spec
  `pricing-summary-extraction.md`) — the ~525-LOC right-panel pricing summary moved to a presentational
  `client/src/components/PricingSummary.js`. Renders the server quote (accommodation struck/green,
  options/resources with "Offrir", extra-guest, tourist tax + detail, VAT breakdown, total,
  deposit/balance/caution); owns its display-detail toggles internally; lifts "Offrir" interactions to
  the page via callbacks. No behavior/visual change; verified by a clean `CI=true` build + in-browser
  (0 console errors, identical rendering).
- **ReservationPage action bar → shared `PageActionBar`** (Bloc 3 slice 3c-1, spec
  `reservation-page-action-bar.md`) — the bespoke `position: fixed` bar (and its `mt` layout
  compensation + hard-coded sidebar offset) is replaced by the shared sticky `<PageActionBar>`, same
  actions/conditions/handlers (back, créer/transformer devis, statut devis, PDF, passer en réservation,
  Save, Cancel, Supprimer). `PageActionBar` gained two backward-compatible capabilities: an `onBack`
  handler (for computed back navigation) and custom-node action items (`{ node }`, e.g. the devis-status
  `<Select>`). Verified in-browser (reservation + devis modes, 0 console errors).
- **CalendarPage dead reservation dialog removed** (Bloc 3 slice 3b, spec `calendar-dead-dialog-removal.md`)
  — pure dead-code removal, no behavior change. The unreachable in-page reservation create/edit dialog
  (`dialogOpen` was never set true; all entry points navigate to the ReservationPage route) and
  everything used only by it (form state, debounced pricing effect, option/resource setters,
  `applyQuoteToForm`, capacity/baby-bed loaders, inline create-client flow, related imports) were
  deleted: `CalendarPage.js` 2274 → 1251 LOC (−1023). The live calendar (rendering, navigation, note
  dialog, occupied/closure/cleaning bands) is unchanged; verified by a clean `CI=true` build + in-browser
  check (calendar renders, reservation click → `/reservations/:id`, 0 console errors).
- **Reservations backend MVC extraction** (Bloc 3 slice 3a, spec `reservations-backend-mvc.md`) — pure
  structural refactor, **no API/behavior change**. The 1317-LOC `routes/reservations.js` monolith is now
  thin (verb/path → controller); logic moved to `controllers/reservationsController.js`,
  `models/reservationsModel.js` (all SQL), and pure utils `utils/occupancy.js`,
  `utils/reservationAudit.js`, `utils/bedDistribution.js`, `utils/reservationHelpers.js`. Same endpoints,
  payloads, status codes, history/iCal-lock/pricing-snapshot behavior. New unit tests (occupancy, audit)
  + manual create/conflict/history/delete verification; full suite green (255).
- **Pricing (Bloc 2):** `PlanningPage` now renders the server-computed effective quantity (`billedUnits`)
  instead of recomputing per-price-type multipliers client-side (`getMultiplier`/`getEffectiveQty`
  removed). `CalendarPage`'s dead local `recalcPrice` duplicate was removed. `ReservationPage`'s
  "Actualiser les tarifs" now also clears any manual price (reverts fully to engine pricing), and the
  redundant "Remise sur hébergement" summary line was removed (the struck engine price already conveys it).
- `GET /api/school-holidays` response shape changed from `Array` to `{ periods, syncState }`. Updated existing callers (`CalendarPage.js`, `PropertyPricingSeasonsPage.js`) to extract `.periods`. New endpoints `POST /api/school-holidays/sync`, `GET/PUT /api/school-holidays/sync-settings`, `PUT /api/school-holidays/:id/unlock`. `POST` and `PUT /:id` now validate (`400 INVALID_PERIOD`) and `PUT /:id` flips `isLocked = 1` when editing an officially-imported row.
- `scheduledTasks.js` runs a new hourly tick for school-holidays auto-sync, plus a 60s boot tick that fires the first sync if the configured interval has elapsed since the last run.
- `POST /api/reservations` and `PUT /api/reservations/:id` now reject overlapping closures with `409 CLOSURE_COVERS_DATE` and a French message naming the closure label + range.
- `GET /api/reservations/occupied-dates/:propertyId` now appends closure-covered date strings to its result (shape kept as `string[]` for backward compatibility) so the Calendar drag-gate automatically blocks closed days.
- `resources` no longer relies on the legacy `propertyId` single-FK column for property scoping. All callers (`routes/resources.js` baby-bed availability, `routes/reservations.js` baby-bed validation in POST + PUT, `database.js` baby-bed seed) now read/write `propertyIds` JSON exclusively. Single source of truth.
- Settings backend extracted to MVC: `routes/settings.js` → thin route → `controllers/settingsController.js` → `models/settingsModel.js`. Validation in dedicated `utils/settingsValidation.js`. Response shaping in `utils/settingsResponse.js`. Multer logo config in `middleware/multerLogoUpload.js`.
- `GET /api/settings` response wrapped under `{ company, quote, googleCalendar, updatedAt, updatedAtLabel }`; the Google Calendar private key is masked server-side (`privateKeyMasked` + SHA-256 `privateKeyFingerprint`); service account email is also exposed in a masked form for display.
- `PUT /api/settings` validates inputs and supports per-field "absent = preserve" semantics within each group, plus 3-way `privateKey` semantics (absent → preserve, `""` → clear, non-empty → validate + store).
- Google Calendar helpers (`getGoogleCalendarConfig`, `getGoogleCalendarClient`, `sanitizePrivateKey`) moved from `routes/googleCalendar.js` to `utils/googleCalendarClient.js`. `googleapis` is now `require`'d lazily so a missing dependency does not break boot or other endpoints.
- `routes/devis.js` now sources app settings via `settingsModel` (instead of the removed `db.getAppSettings`).

### Added
- **Production now serves HTTPS directly on `:4000`** (no Nginx / Caddy in front). On first deploy
  the GitHub Actions workflow runs `server/scripts/generate-self-signed-cert.sh` and stores the
  result in `~/guestflow/certs/` (persistent across deploys), then PM2 starts with
  `HTTPS_ENABLED=true` + `TLS_CERT_PATH` / `TLS_KEY_PATH` pointing at the persistent location.
  Node loads the cert via the new `server/src/utils/httpsBootstrap.js` builders and uses
  `https.createServer` instead of plain `http.createServer`. The cert generation script
  auto-detects every local IPv4 + hostname + localhost for the SAN list; it can also be invoked
  manually with explicit IPs / hostnames or with `--force` to regenerate before expiry. Cert + key
  are gitignored (`server/certs/*.crt` / `*.key`). Bootstrap pins a hard safety: when
  `HTTPS_ENABLED=true` but the cert or key files are missing, the server **refuses to boot** with
  a clear error pointing at the helper script — no silent downgrade to HTTP that would leak a
  `Secure` cookie over plain transport. 9 new test cases in `https-bootstrap.unit.test.js` lock
  the boot decision (HTTP path, HTTPS path, both files missing, one missing, env var overrides,
  no-app guard). The browser warns once per device that the cert isn't trusted by a known CA
  (expected — self-signed for a LAN-only deploy); after acceptance HSTS makes HTTPS sticky for
  1 year. README §HTTPS documents the per-device cert-trust workflow (accept-once OR install
  rootCA) + the HSTS-clearing instructions for every major browser. Access changes from
  `http://<your-pi-lan-ip>:4000` to `https://<your-pi-lan-ip>:4000`.

### Fixed
- **Production deploy over plain HTTP hit "Une erreur TLS a provoqué l'échec de la connexion
  sécurisée".** When the Helmet config was introduced (V02.00.00), HSTS + CSP's
  `upgrade-insecure-requests` + the `Secure` flag on the session cookie were all gated on
  `NODE_ENV === 'production'`. That conflates "this is a production build" with "TLS is available
  at the network edge" — fine when the prod stack runs behind an HTTPS reverse proxy, fatal on a
  Raspberry Pi serving plain HTTP (Safari upgraded every asset URL to `https://`, TLS handshake
  failed, the SPA never loaded). Worse, the symptom is sticky: once HSTS was emitted by the prior
  deploy, the browser keeps refusing HTTP for the host up to the `max-age` (Helmet's default = 1
  year) until cleared by hand. Fix:
  - New env var `HTTPS_ENABLED` is the explicit switch for the network-edge TLS policy. `true` →
    HSTS on + CSP `upgrade-insecure-requests` on + session cookie `Secure`. Anything else (incl.
    `NODE_ENV=production` alone) → all three off.
  - Helmet + cookie options extracted to `server/src/utils/securityConfig.js` (pure builders, no
    side effects) so the rules are testable and version-controlled in one place.
  - Helmet's `useDefaults: true` is replaced with `useDefaults: false` — Helmet's default CSP
    directives include `upgrade-insecure-requests`, exactly what we are trying NOT to emit when
    HTTPS isn't available. Listing the directives ourselves makes it impossible for a future
    Helmet release to silently turn the upgrade back on.
  - GitHub Actions deploy workflow now sets `HTTPS_ENABLED=true` (with `TLS_CERT_PATH` /
    `TLS_KEY_PATH` pointing at the persistent `~/guestflow/certs/` directory provisioned in the
    new "Added" entry above) so the Pi serves HTTPS directly. If you ever need to disable TLS
    (private LAN tunnel, etc.) it's a one-line unset in the deploy workflow.
  - README §HTTPS gets the full rule table + per-browser HSTS-clearing instructions (Safari macOS
    + iOS, Chrome `chrome://net-internals/#hsts`, Firefox).
  - Regression test `server/src/tests/security-config.unit.test.js` (11 cases) pins the entire
    rule table; the explicit "NODE_ENV=production alone does NOT re-enable HTTPS enforcement"
    case will turn red if anyone reverts to the conflated logic.
- **"Nouveau devis" button was invisible on the Devis page.** `DevisPage` was passing an
  `actions={<Button>}` prop to the legacy `PageHeader` component, which expects
  `actionLabel` / `actionIcon` / `onAction` instead — the button (and the page subtitle) were
  silently dropped. Migrated `DevisPage` to the standard `<PageActionBar>` per CLAUDE.md §7;
  the create button now lives in `actionsBefore` as a custom node so it keeps its full label
  ("Nouveau devis") rather than collapsing to an icon-only IconButton. Click navigates to
  `/reservations/new?mode=devis` (the existing devis editor). New regression test
  `DevisPage.test.js` (3 cases: button visible, navigation target, button reachable while the
  list is still loading).
- **Per-platform tourist tax (owner-collect) leaked into the accountant journal:** with the new
  "tax in complement" schedule, the accounting export still pro-rated deposit + balance against
  `totalStayTtc` and pro-rated the complement (= pure tax) as if it were stay revenue. Result on
  owner-collect non-direct entries: deposit + balance under-counted HT/VAT (the difference dumped
  into the residue / last VAT line), and the complement emitted bogus accommodation HT/VAT lines
  for an amount that is *not* revenue (it's tax owed to the commune). Fix in
  `accountingModel.buildEntry`: when the engine flags `touristTaxCollectedOnArrival = true`,
  pro-rate deposit + balance against `finalPrice` (no tax inside those amounts), and carve the
  tax portion out of the complement entry — dropping the entry entirely if it boils down to pure
  tax (the tourist tax is reported via Suivi taxe de séjour, never via the accountant journal).
  Direct + platform-collect cases unchanged. Regression tests:
  `accounting-model-tourist-tax.unit.test.js` (7 cases). Specs
  `per-platform-tourist-tax-collection.md` + `accountant-accounting-export.md` updated.
- **Per-platform tourist tax (owner-collect) was invisible on the reservation panel and the wrong
  amount was scheduled in the balance:** two distinct bugs in the same flow. (1) `PricingSummary`
  derived "tax offered by platform" from the legacy hardcoded `platform !== 'direct'` instead of
  reading `quote.touristTaxOfferedByPlatform`, so flipping `collectsTouristTax` to 0 on a non-direct
  source had no visible effect — the line kept the strike-through and the "Offert" chip. Compounded
  by `totalSejour = isIcalSource ? raw - tax : raw`, which silently stripped the tax from the total
  for any iCal-imported reservation regardless of the resolved flag. (2) The pricing engine baked
  the owner-collected tax into the balance even though Adrien actually collects it on check-in. Fix:
  - `PricingSummary` now reads `quote.touristTaxOfferedByPlatform` (with a benign legacy fallback
    while the first quote is in flight) and trusts `quote.totalStayPrice` as authoritative.
  - The engine now flags `touristTaxCollectedOnArrival = true` when the platform is non-direct AND
    `collectsTouristTax = 0`, derives `acompte` + `solde` from `finalPrice` (stay excl. tax), and
    routes the tax into `complementAmount` from save 1 (not gated on deposit/balance being paid).
    `totalStayPrice` still equals `finalPrice + tax`. Direct + platform-collect cases are unchanged.
  - `PricingSummary` renders an "À collecter à l'arrivée (incluse dans le complément)" caption
    when the new flag is set.
  Tests: `pricing-tourist-tax-on-arrival-schedule` (5 cases — non-direct owner-collect, direct
  unchanged, platform-collect unchanged, depositPaid mid-state recomputes balance against
  `finalPrice`, complementPaid frozen). Engine-consumer suites (pricing / devis / accounting /
  reservations) green at 98 / 98. Spec `per-platform-tourist-tax-collection.md` updated (functional
  rules 5 + 7, architecture, test plan, UI/UX). No retroactive recompute on past reservations.
- **Per-platform tourist tax toggle didn't update the property's iCal sources table:** the SELECT in
  `propertiesModel.getByIdWithDetails` (powering `GET /api/properties/:id`) was missing
  `collectsTouristTax`, so the nested `icalSources` array always returned the field as `undefined`.
  The "Taxe collectée" chip on `/properties/:id` then fell back to "Plateforme" regardless of the
  saved value, even though the dedicated `GET /api/properties/:id/ical-sources` endpoint (and the
  pricing engine + Suivi page) had the right value. SELECT now includes `collectsTouristTax`;
  regression test added (`properties-model`). Spec `per-platform-tourist-tax-collection.md` updated.
- **Public iCal export leaked devis (introduced by the devis↔reservation fusion):** the `.ics` feed
  selected all `reservations` rows for a property without a `kind` filter, so after the fusion a devis was
  exported as a booked event — external platforms would treat a tentative quote as unavailable and block
  real bookings. The export now advertises only `kind='reservation'`. Regression-tested (`ical-model`).
- **Selecting a non-hourly resource broke the quote (price + summary):** the pricing engine's
  resource-line builder referenced an undefined `priceType` (instead of `resource.priceType`) when a
  resource was **not** `per_hour`/complex/free-minutes, throwing `ReferenceError` and failing the whole
  quote. `per_stay` / `per_person` / `per_night` / `per_person_per_night` resources now price correctly
  (e.g. a 20€ per-person-per-night resource over 2 guests × 3 nights = 120€). Regression test added
  (`pricing-resource-types`).
- **Non-hourly resources couldn't be offered:** the "Offrir" button in the pricing summary was gated
  behind `isPerHour`, so only complex/hourly resources could be comped. It now shows for **every**
  selected resource (like options) — the model/engine/persistence already supported it.
- **iCal sync created an orphan client on a renamed-guest update:** the iCal client was resolved for
  every event, but the update path never relinks `clientId`, so a changed guest name produced an unused
  client row. The client is now resolved only in the insert branches (guarded by a new sync test).
- **Client creation was broken (POST /api/clients hung):** the `clientsController` attached its
  `create(model)` factory as `.create`, overwriting the `create` request handler — so the route called the
  factory and never responded. The factory is now `.buildController` on the Bloc-1 controllers
  (clients/resources/resource-bookings), and POST/PUT handlers work again. Covered by the controller tests.
- **Devis PDF footer wrapped SIRET/TVA onto two lines:** the per-page footer's center column was too narrow,
  so `SIRET : … • N° TVA : …` could wrap. The column is now widened and set to a single line
  (`lineBreak: false`), keeping SIRET and TVA on one line.
- **Devis update history never recorded changes:** the audit "before" snapshot was captured *after* the
  row was already updated, so update diffs were always empty. The devis MVC refactor captures the baseline
  before persisting, so editing a devis now records a real history entry.
- **False "Modifications non enregistrées" prompt on a freshly loaded reservation/devis:** the on-mount
  server pricing recalc reshaped the loaded form after the unsaved-changes baseline was captured, so a
  just-opened (or just-converted) record was wrongly flagged dirty and prompted on "Annuler"/navigation.
  The baseline is now captured **after** the first quote applies for existing records (new/prefilled
  records still baseline immediately); genuine edits still flag dirty. Spec `devis-accept-to-reservation.md`.
- **Devis PDF ignored the manual accommodation price:** when a manual price (`customPrice`) overrode the
  accommodation, the PDF still printed the engine-computed price on the accommodation line, so the HT and
  TTC subtotals were wrong (only the grand total TTC, which uses `finalPrice`, was right). The PDF now
  renders a single accommodation row at the manual amount with the original engine price struck through
  (in either direction, like an offered line), so the rows sum to `finalPrice` and the HT/TTC subtotals
  reconcile with the total.
- **Devis PDF download returned 401 ("Impossible de générer le PDF"):** the PDF was fetched with a raw
  `fetch` that didn't send credentials. With `REACT_APP_API_URL` absolute (cross-origin in dev), the
  default fetch omits the session cookie → `401`. Added `api.getDevisPdfBlob(id)` (fetch with
  `credentials: 'include'`) used by both the Devis list page and the reservation devis-mode download.
- **Dev TLS error in Safari (page would not load over HTTP):** Helmet's default CSP includes
  `upgrade-insecure-requests` and HSTS pins the host to HTTPS, so a plain-HTTP dev session upgraded
  `http://localhost/main.<hash>.js` to `https://localhost` → "Une erreur TLS a provoqué l'échec de la
  connexion sécurisée". CSP and HSTS are now enforced in **production only** (`NODE_ENV === 'production'`,
  behind the HTTPS reverse proxy); they are disabled in development. Spec: `security-hardening.md`.
- **Missing favicon (404) + default icon:** added a default GuestFlow favicon (`favicon.svg` + `favicon.ico`
  for Safari/legacy) referenced from `index.html`, so the app shows a brand icon and stops requesting a
  missing `/favicon.ico` even when no company logo is configured. When a company logo *is* set, it still
  overrides the favicon (the default icon links are replaced in `App.js`).
- **Offered options/resources price bug (Bloc 2):** an option/resource that was "offert" (billed 0) on a
  saved reservation, then made paid again, no longer stays at 0 — the real price is always recomputed and
  restored. The fragile `totalPrice = 0 → offered` inference (in `pricing.js`, plus the SQL fallbacks in
  `reservations.js` and `devis.js`) was replaced by a single lossless rule: `offered` only zeroes the
  billed total while the real price is preserved as `originalTotalPrice`. Covered by a round-trip unit test.
- Private key is no longer returned in clear text by `GET /api/settings`.
- The Settings form no longer wipes the private key when saved without re-entering it (handled by `MaskedTextField` + 3-way payload semantics).
- The Google Calendar section now exposes a "Tester la synchronisation" button — no need to go to Réservations to verify credentials.

### Removed
- **Legacy "Accès comptable" card** in `/parametres` (`SettingsAccountantAccessSection.js`). Its
  single-purpose "create the accountant + show the temp password on screen" hack is canonicalized
  by `/comptes` (admin only) where the temp password is emailed instead. The schema column
  `users.role` is dropped in the same migration — see Migration below.
- **"Extraction Taxe de séjour" navigation card on `/finance`** — the same page is reachable from
  the sidebar (Suivi financier → Taxe de séjour), so the redundant card on the overview was just
  noise. The Suivi page itself is unchanged.
- **Dead `recalcPrice` wrapper** in `ReservationPage.js` — a no-op (`return { ...updatedForm }`) left over
  after the pricing engine moved server-side (Bloc 2). Its 9 call sites now spread the form directly.
  Behavior-preserving; closes out the client-side pricing logic removal.
- **`devis_*` tables** (`devis`, `devis_options`, `devis_custom_options`, `devis_resources`,
  `devis_nights`, `devis_history`) — folded into the `reservations` family (`kind='devis'`). Data migrated
  (see Migration).
- **`GET /api/finance/pending`** — folded into the new `/finance/operational` (its only consumer was
  FinancePage). The endpoint now returns `404`.
- **Client-side payment math** — both `FinancePage.getRemainingDue` and `Dashboard.getRemainingDue`, plus
  FinancePage's client-side overdue derivation + upcoming-by-property grouping (now server-computed).
- **Client-side public-holiday computation** (`getFrenchPublicHolidays` in `client/src/frenchHolidays.js`)
  — moved server-side; the file now keeps only the `getSchoolHolidayInfo` lookup.
- **Dead `PRICE_TYPE_LABELS` constant in `CalendarPage.js`** — leftover from the removed reservation
  dialog, referenced nowhere.
- **Dead `client/src/pages/DevisForm.js` (501 LOC)** — unrouted and imported nowhere (all devis editing
  goes through `ReservationPage ?mode=devis`). Removed during the devis MVC refactor.
- `db.getAppSettings` / `db.upsertAppSettings` (logic moved to `settingsModel`). `database.js` keeps only DDL + migrations + the singleton bootstrap for `app_settings`.

### Migration
- **Admin account management:** `users` gains `firstName`, `lastName`, `companyName`, `notes`
  (all `TEXT NOT NULL DEFAULT ''`) and `lastLoginAt TEXT NULL`. New `user_roles(userId, role)`
  table with `ON DELETE CASCADE`. On boot, existing single-role values are backfilled into the
  join table and the legacy `users.role` column is dropped (native `ALTER TABLE DROP COLUMN`
  supported by better-sqlite3 v11). `app_settings` gains 8 SMTP/public-URL columns
  (`smtpHost`, `smtpPort` default 587, `smtpSecure` default 0, `smtpUsername`,
  `smtpPasswordEncrypted` — AES-256-GCM at rest —, `smtpFromEmail`, `smtpFromName` default
  `'GuestFlow'`, `publicUrl`). Idempotent; replaying the migration on an already-migrated DB is a
  no-op.
- **Per-platform tourist tax collection:** `ical_sources` gains
  `collectsTouristTax INTEGER NOT NULL DEFAULT 1`. The default `1` preserves the prior
  hardcoded behaviour (non-direct = platform collects = tax offered) until the owner explicitly
  flips a source to `0` on the property page. Idempotent.
- **Complément à percevoir columns:** `reservations` gains `complementAmount REAL NOT NULL DEFAULT 0`,
  `complementPaid INTEGER NOT NULL DEFAULT 0`, `complementPaidDate TEXT`. For existing fully-paid
  reservations (`depositPaid = 1 AND balancePaid = 1`), `complementAmount` is backfilled to
  `max(0, finalPrice + touristTaxTotal − depositAmount − balanceAmount)` so any silent gap from
  before this fix is visible the moment the migration runs.
- **Reservation payment dates + platform gross:** `reservations` gains `depositPaidDate TEXT`,
  `balancePaidDate TEXT` and `clientGrossAmount REAL`. Paid-dates are backfilled once from the
  corresponding due-dates for rows already marked paid (sensible accounting date for legacy data);
  `clientGrossAmount` stays NULL on existing rows. Idempotent.
- **Global VAT rates:** `app_settings` gains `vatRateAccommodation` (default 10) and `vatRateStandard`
  (default 20). Backfilled once from any existing property's `vatPercentageAccommodation` (→
  accommodation) and `vatPercentageOptions` (→ standard) so a single-gîte install keeps its configured
  values; the per-property `vatPercentage*` columns are then **dropped** via `ALTER TABLE … DROP COLUMN`.
  Migration is defensive (skips backfill if old columns absent) and idempotent.
- **Devis ↔ Reservation fusion (one-time, backed up):** on boot, `reservations` gains
  `kind`/`devisNumber`/`devisStatus`/`validUntil`/`convertedReservationId` (+ a unique index on
  `devisNumber` and a `kind` index). If the legacy `devis` table exists, the DB is first copied to a
  timestamped `*.pre-devis-fusion-*.bak` backup, then `migrateDevisIntoReservations` folds every devis into
  `reservations` (`kind='devis'`) with its options/custom options/resources/nights/history moved into the
  `reservation_*` children — insert + verify + drop run in one transaction (all-or-nothing). Idempotent
  (skips once `devis` is gone). Rollback = restore the `.bak`. Existing reservations are untouched.
- **Resource applicability pivot (Bloc 1):** new `resource_properties` table (`resourceId`, `propertyId`).
  On boot, `migrateResourcePropertiesFromJson` backfills it from the legacy `resources.propertyIds` JSON
  (empty stays global; stale property ids skipped), then drops the `propertyIds` column. Idempotent;
  lossless.
- **Clients single-phone (Bloc 1):** the legacy multi-number `clients.phoneNumbers` JSON column is
  dropped. On boot, `migrateClientPhonesToSingle` keeps each client's **first** listed number in the
  scalar `phone` (extras discarded) before the column is removed; idempotent (no-op once gone). Locally
  lossless (0 clients had >1 number); in prod, multi-number clients keep only their first number.
- **Users + sessions (Bloc S):** new `users` table (`CREATE TABLE IF NOT EXISTS` + `uniq_users_email`)
  seeded with the default admin on first launch (`mustChangePassword = 1`); a `sessions` table is
  created by `better-sqlite3-session-store`. Existing Google credentials in `app_settings` are
  encrypted in place once on boot (idempotent, tagged `enc:v1:`); `server/.env.local` gains
  auto-generated `GUESTFLOW_ENCRYPTION_KEY` and `GUESTFLOW_SESSION_SECRET` (git-ignored).
- `school_holidays` table gains three additive columns: `externalRef TEXT`, `isLocked INTEGER NOT NULL DEFAULT 0`, `lastSyncedAt TEXT` (idempotent `ALTER TABLE ADD COLUMN` block). Existing rows: `externalRef = NULL`, `isLocked = 0`. New singleton table `school_holidays_sync_state` auto-created. New index `idx_school_holidays_externalRef` added via the DB hygiene catalog.
- New table `establishment_closures` auto-created on boot via the existing `CREATE TABLE IF NOT EXISTS` pattern. No data migration needed — the table never existed before.
- On boot, the DB hygiene pass attempts to drop the legacy `resources.propertyId` column. SQLite refuses to drop a column that is part of a `FOREIGN KEY` definition, so on existing databases the column stays in the schema but is no longer read or written by any code — an info log explains this is harmless. Fresh installations / minimal test schemas without the FK definition do drop the column cleanly.
