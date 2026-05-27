# Changelog

All notable changes to GuestFlow are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Security hardening — headers, rate limiting, uploads, validation** (Bloc S PR 2, spec
  `security-hardening.md`):
  - **HTTP security headers** via `helmet`, including a CSP tuned for the SPA
    (`script-src 'self'` thanks to `INLINE_RUNTIME_CHUNK=false`; `style-src`/`font-src` allow MUI inline
    styles + Google Fonts; `img-src` allows uploaded images). Verified against a production build.
  - **Rate limiting** (`express-rate-limit`): login 10 failed/15 min/IP, global API 300/15 min/IP
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
- **Offered options/resources price bug (Bloc 2):** an option/resource that was "offert" (billed 0) on a
  saved reservation, then made paid again, no longer stays at 0 — the real price is always recomputed and
  restored. The fragile `totalPrice = 0 → offered` inference (in `pricing.js`, plus the SQL fallbacks in
  `reservations.js` and `devis.js`) was replaced by a single lossless rule: `offered` only zeroes the
  billed total while the real price is preserved as `originalTotalPrice`. Covered by a round-trip unit test.
- Private key is no longer returned in clear text by `GET /api/settings`.
- The Settings form no longer wipes the private key when saved without re-entering it (handled by `MaskedTextField` + 3-way payload semantics).
- The Google Calendar section now exposes a "Tester la synchronisation" button — no need to go to Réservations to verify credentials.

### Removed
- `db.getAppSettings` / `db.upsertAppSettings` (logic moved to `settingsModel`). `database.js` keeps only DDL + migrations + the singleton bootstrap for `app_settings`.

### Migration
- **Users + sessions (Bloc S):** new `users` table (`CREATE TABLE IF NOT EXISTS` + `uniq_users_email`)
  seeded with the default admin on first launch (`mustChangePassword = 1`); a `sessions` table is
  created by `better-sqlite3-session-store`. Existing Google credentials in `app_settings` are
  encrypted in place once on boot (idempotent, tagged `enc:v1:`); `server/.env.local` gains
  auto-generated `GUESTFLOW_ENCRYPTION_KEY` and `GUESTFLOW_SESSION_SECRET` (git-ignored).
- `school_holidays` table gains three additive columns: `externalRef TEXT`, `isLocked INTEGER NOT NULL DEFAULT 0`, `lastSyncedAt TEXT` (idempotent `ALTER TABLE ADD COLUMN` block). Existing rows: `externalRef = NULL`, `isLocked = 0`. New singleton table `school_holidays_sync_state` auto-created. New index `idx_school_holidays_externalRef` added via the DB hygiene catalog.
- New table `establishment_closures` auto-created on boot via the existing `CREATE TABLE IF NOT EXISTS` pattern. No data migration needed — the table never existed before.
- On boot, the DB hygiene pass attempts to drop the legacy `resources.propertyId` column. SQLite refuses to drop a column that is part of a `FOREIGN KEY` definition, so on existing databases the column stays in the schema but is no longer read or written by any code — an info log explains this is harmless. Fresh installations / minimal test schemas without the FK definition do drop the column cleanly.
