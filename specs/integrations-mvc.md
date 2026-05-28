# Bloc 6 — Integrations MVC (Google Calendar, iCal export, calendar notes, options)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/integrations-mvc` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 6 — Integrations (last bloc). See `specs/ROADMAP.md`. |

---

## 1. Context

The last routes without a controller/model:

- **`routes/googleCalendar.js` (202)** — has `googleCalendarController` but only `test-connection` uses it;
  `/status` and `/sync-reservations` are inline, alongside ~90 LOC of pure Google-event builders.
- **`routes/ical.js` (70)** — the **public iCal export** + token lifecycle; the real work
  (`getOrCreateIcalToken`, `exportPropertyAsIcal`, `escapeIcalText`, `formatIcalDate`) lives in
  `database.js`. No controller/model.
- **`routes/calendarNotes.js` (45)** — note CRUD, fully inline.
- **`routes/options.js` (144)** — option CRUD + `property_options` links + progressive-tier normalization,
  fully inline.

**🐛 Live bug to fix here (introduced by the devis↔reservation fusion):** `exportPropertyAsIcal` selects
`FROM reservations r WHERE r.propertyId = ?` **without a `kind` filter**, so since the fusion a **devis is
exported as a booked event** in the public `.ics` feed → other platforms (Airbnb/Booking…) treat a
tentative quote as unavailable and **block real bookings**. The export must only advertise
`kind='reservation'`. _(This is the export side; distinct from the import [[ical-anti-overbooking]]
contract.)_

## 2. Goal

These four routes become thin routes over controllers + models/utils, with the Google-event builders and
the iCal export/token logic moved out of the route/`database.js`. The iCal export is fixed to exclude
devis. **No API or UX change** (besides the export no longer leaking devis); no schema change.

## 3. Functional rules

1. **iCal export excludes devis.** `exportProperty` selects only `kind='reservation'`. A devis never
   appears in the public feed. (Regression-tested.)
2. **MVC.** Each route parses → controller → model/util. No SQL/business logic left in the four routes or
   (for iCal) in `database.js`.
3. **Behaviour-preserving.** Same endpoints, payloads, status codes, headers (iCal `Content-Type:
   text/calendar`, `.ics` attachment), token URLs, French copy, validation, `404`s, and the Google sync
   `created/updated` semantics + `GOOGLE_CALENDAR_NOT_CONFIGURED` handling.
4. **Google sync reads only reservations** (`kind='reservation'` — already filtered) + their options.
5. **No client change** (contracts identical).

**Edge cases preserved:** missing property `404` (ical token/regenerate), unknown token `404` (export),
empty note → delete (calendarNotes PUT), option↔property links replaced on update, progressive-tier
normalization, Google not-configured `400`, Google event upsert (insert when `404`, else update).

---

## 4. Architecture

> **Fat backend, thin frontend.** Pure server refactor; no client touch. Event builders + iCal formatting
> are pure utils; DB access + shaping in models.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `icalModel.js` | C | Token lifecycle (`getOrCreateToken`, `regenerateToken`, `findPropertyIdByToken`) + `exportProperty(propertyId)` (the `.ics` generation, **`kind='reservation'` filtered**). Pure `escapeIcalText`/`formatIcalDate` move here. `create(db)` factory. |
| `controllers/` | `icalController.js` | C | token / export (sets `text/calendar` headers) / regenerate. |
| `routes/` | `ical.js` | T | Thin → `icalController`. |
| `utils/` | `googleCalendarEvents.js` | C | Pure event builders moved from the route: `buildEventTitle/Description/Payload`, `formatCountLabel`, `formatOptionQuantity`, `getGoogleEventIdForReservation`, `getErrorStatus`, `upsertReservationEvent`. |
| `models/` | `googleCalendarModel.js` | C | `listReservationsForSync()` — `kind='reservation'` reservations + their options (the query inline today). |
| `controllers/` | `googleCalendarController.js` | T | Adds `status` + `syncReservations` (config gate → model → events util → upsert loop). Keeps `testConnection`. |
| `routes/` | `googleCalendar.js` | T | Thin → controller. |
| `models/` | `optionsModel.js` | C | list/get/create/update/remove (+ `property_options` links + `normalizeProgressiveOptionTiers`). `create(db)` factory (named `buildModel` to avoid clobbering the `create` method). |
| `controllers/` | `optionsController.js` | C | Thin handlers. |
| `routes/` | `options.js` | T | Thin. |
| `models/` | `calendarNotesModel.js` | C | `listForProperty`, `upsert`, `remove`. |
| `controllers/` | `calendarNotesController.js` | C | Thin handlers. |
| `routes/` | `calendarNotes.js` | T | Thin. |
| `database.js` | `database.js` | T | Remove `getOrCreateIcalToken`/`exportPropertyAsIcal`/`escapeIcalText`/`formatIcalDate` + the `db.*` attachments (moved to `icalModel`). Keep the `ical_tokens` table DDL. |
| `utils/` | `googleCalendarClient.js` · `textFormatters.js` | — | Reused. |

### 4.2 Client side

No change (API contracts identical).

### 4.3 API contract

Unchanged. Same endpoints/payloads/headers; the only observable difference is the public iCal feed no
longer contains devis events.

---

## 5. Data model

No schema change.

## 6. UI / UX

No visible change.

## 7. Test plan

### Server unit tests
- [x] `ical-model.unit.test.js` (3) — `exportProperty` **excludes `kind='devis'`** (the fix) + includes
      reservations; unknown property → null; token get-or-create stable / regenerate replaces / lookup.
- [x] `options-model.unit.test.js` (4) — CRUD + `property_options` link replacement + progressive-tier
      normalization (dedupe/sort/sanitize).
- [x] `calendar-notes-model.unit.test.js` (3) — list (range + all), upsert insert/update, empty → delete,
      50-char cap.
- [x] Google event builders covered by `google-calendar-sync.unit.test.js` (repointed to
      `utils/googleCalendarEvents`).
- [x] Full server suite green (**350**, run serially — the suite has pre-existing parallel-DB contention
      flakiness unrelated to this change).

### Manual UI verification (browser, live DB)
- [x] **iCal export excludes devis** — Gite (25 reservations + 5 devis) → `.ics` has exactly 25 events;
      Tente (12 + 1) → 12 events. The fusion leak is fixed.
- [x] `/api/options`, `/api/calendar-notes/:id`, `/api/google-calendar/status` all `200`; `0` console
      errors. (Options-page / notes UI interactions covered by the model tests + the routes responding.)

## 8. Out of scope

- The iCal **import** sync (lives in `routes/properties.js` / `properties-mvc`) and its anti-overbooking
  contract — untouched here.
- `getSchoolHolidayInfo` client lookup; any new Google features.

## 9. Open questions

- **Q: `googleCalendarModel` vs query inline in the controller?** Proposed: a small model
  (`listReservationsForSync`) so the controller stays thin and the `kind='reservation'` + options shaping
  is testable. Confirm during implementation.
