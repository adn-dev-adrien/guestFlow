# Changelog

All notable changes to GuestFlow are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
- `POST /api/reservations` and `PUT /api/reservations/:id` now reject overlapping closures with `409 CLOSURE_COVERS_DATE` and a French message naming the closure label + range.
- `GET /api/reservations/occupied-dates/:propertyId` now appends closure-covered date strings to its result (shape kept as `string[]` for backward compatibility) so the Calendar drag-gate automatically blocks closed days.
- `resources` no longer relies on the legacy `propertyId` single-FK column for property scoping. All callers (`routes/resources.js` baby-bed availability, `routes/reservations.js` baby-bed validation in POST + PUT, `database.js` baby-bed seed) now read/write `propertyIds` JSON exclusively. Single source of truth.
- Settings backend extracted to MVC: `routes/settings.js` → thin route → `controllers/settingsController.js` → `models/settingsModel.js`. Validation in dedicated `utils/settingsValidation.js`. Response shaping in `utils/settingsResponse.js`. Multer logo config in `middleware/multerLogoUpload.js`.
- `GET /api/settings` response wrapped under `{ company, quote, googleCalendar, updatedAt, updatedAtLabel }`; the Google Calendar private key is masked server-side (`privateKeyMasked` + SHA-256 `privateKeyFingerprint`); service account email is also exposed in a masked form for display.
- `PUT /api/settings` validates inputs and supports per-field "absent = preserve" semantics within each group, plus 3-way `privateKey` semantics (absent → preserve, `""` → clear, non-empty → validate + store).
- Google Calendar helpers (`getGoogleCalendarConfig`, `getGoogleCalendarClient`, `sanitizePrivateKey`) moved from `routes/googleCalendar.js` to `utils/googleCalendarClient.js`. `googleapis` is now `require`'d lazily so a missing dependency does not break boot or other endpoints.
- `routes/devis.js` now sources app settings via `settingsModel` (instead of the removed `db.getAppSettings`).

### Fixed
- Private key is no longer returned in clear text by `GET /api/settings`.
- The Settings form no longer wipes the private key when saved without re-entering it (handled by `MaskedTextField` + 3-way payload semantics).
- The Google Calendar section now exposes a "Tester la synchronisation" button — no need to go to Réservations to verify credentials.

### Removed
- `db.getAppSettings` / `db.upsertAppSettings` (logic moved to `settingsModel`). `database.js` keeps only DDL + migrations + the singleton bootstrap for `app_settings`.

### Migration
- New table `establishment_closures` auto-created on boot via the existing `CREATE TABLE IF NOT EXISTS` pattern. No data migration needed — the table never existed before.
- On boot, the DB hygiene pass attempts to drop the legacy `resources.propertyId` column. SQLite refuses to drop a column that is part of a `FOREIGN KEY` definition, so on existing databases the column stays in the schema but is no longer read or written by any code — an info log explains this is harmless. Fresh installations / minimal test schemas without the FK definition do drop the column cleanly.
