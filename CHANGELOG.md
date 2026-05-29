# Changelog

All notable changes to GuestFlow are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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

### Fixed
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
