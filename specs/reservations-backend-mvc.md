# Reservations backend — MVC extraction

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservations-backend-mvc` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar, slice **3a** (of 3a/3b/3c). See `specs/ROADMAP.md`. |

---

## 1. Context

`server/src/routes/reservations.js` is a 1317-LOC monolith: the Express routes, all DB access, the
pricing-snapshot logic, occupancy/conflict rules, audit-history tracking and bed-distribution all live
inline in one file. This is the recognized tech debt the MVC policy targets (`CLAUDE.md` §6.1): routes
should be thin and delegate to controllers/models, with reusable, unit-tested helpers in `utils/`.

The file currently holds, inline:
- **Endpoints:** `POST /suggest-beds`, `GET /`, `GET /occupied-dates/:propertyId`, `GET /:id`,
  `GET /:id/history`, `POST /calculate-price`, `POST /`, `PUT /:id`, `PATCH /:id/payment`, `DELETE /:id`.
- **Occupancy/conflict rules:** `timeToHour`, `addIsoDays`, `getNightBlocksFromTimes`,
  `buildOccupiedDatesFromReservations`, `validateReservation` (the authoritative availability check).
- **Audit/history:** `normalizeHistoryValue`, `getOptionsSignature`, `getResourcesSignature`,
  `getReservationAuditSnapshotFromDb`, `getReservationAuditSnapshotFromPayload`, `computeAuditChanges`,
  `addReservationHistoryEntry`.
- **Pricing glue:** `getReservationPricingSnapshot` (locked snapshot), `inferCustomAccommodationPrice`,
  `suggestBedDistribution`, plus calls into `utils/pricing.js`.
- **Misc:** `parseJsonArray`, `roundMoney`, `getTodayIsoDate`, `computeNextIcalSyncLocked`,
  `getArchivedReservationError`.

## 2. Goal

Refactor the reservations backend into thin routes → controller → model with unit-tested utils, **with
no change to API behavior or the client**. Same endpoints, same request/response shapes, same business
rules — just a clean, testable structure that future slices (and Bloc 5) build on.

## 3. Functional rules

1. **Behavior-preserving.** Every endpoint keeps its exact path, request body, response shape, status
   codes, validation messages, and side effects (history entries, night rows, iCal lock, pricing
   snapshots). This is a structural refactor, not a feature change.
2. **Thin routes.** `routes/reservations.js` only wires HTTP verbs/paths to controller methods (parse
   params/body → call controller → send result). No business logic, no direct DB calls.
3. **Controller orchestrates.** `reservationsController.js` holds the per-endpoint flow: input parsing,
   calling the pricing engine, the occupancy validator, the model, and shaping the HTTP response.
4. **Model owns DB.** `reservationsModel.js` is the only place with SQL for the reservations domain
   (reservation rows + `reservation_options` / `reservation_custom_options` / `reservation_resources` /
   `reservation_nights` / `reservation_history`), exposed as prepared-statement-backed methods.
5. **Occupancy rules in a pure util.** The night-block + availability logic moves to `utils/occupancy.js`
   as pure, unit-testable functions; the server stays the single authority for conflict rejection.
6. **Audit logic in a pure util.** Snapshot/diff/history helpers move to `utils/reservationAudit.js`.
   - **Human-readable history (2026-06-11).** The options/resources diff is stored as a compact
     signature (`6:1:8.00:c0|…`). `getHistory` (both `reservationsModel` and `devisModel`) resolves
     option/resource ids → names and money via the pure `enrichHistoryChanges` helper, attaching
     ready-to-render `fromText`/`toText` to each option/resource change (e.g.
     `Petit-déjeuner : 0 € (compl.) • Linge de lit : 14 € (compl.)`). Server-owned per the
     fat-backend rule; the client just renders one line per change (`label : from → to`). Custom
     options (synthetic id ≥ 1 000 000) read as `Option personnalisée`; an unknown id as `Option #N`.
7. **No client change.** The 3 client consumers (`CalendarPage`, `ReservationPage`, `MiniPlanningStrip`)
   and their UX helper `utils/reservationConflicts.js` are untouched here (see Out of scope).
8. **Tests.** The extracted occupancy + audit utils and the model get unit tests; the existing suite
   stays green.
9. **Fixed at the 2026-10-27 spec review — default times on create.** A `POST /reservations` without
   `checkInTime` / `checkOutTime` stored 15:00 / 10:00, not the property's `defaultCheckIn` /
   `defaultCheckOut`; on a 16:00 tent the first re-save then billed an « Arrivée anticipée ». The
   controller fills the missing times from the property before pricing (`getPropertyDefaultTimes`).
10. **Fixed at the 2026-10-27 spec review — a stay needs a client.** A `POST /reservations` with no
   `clientId` (and no `newClient`) reached the INSERT and failed on the NOT NULL constraint with a 500.
   It is now refused first: 400 `{ error: 'Un client est requis pour créer la réservation.', code:
   'CLIENT_REQUIRED' }`, nothing written. Pinned by `tests/create-requires-client.unit.test.js`.
11. **Added 2026-11-02 (audit R18-1) — a stay's dates are sound before anything else.** No internal path
   checked them: a reversed stay (`20/11 → 18/11`), a zero-night one, `2027-02-30` or `2027-2-3` was
   created at 0 €, freed its nights for a second booking (the overlap SQL matches nothing against a
   reversed row, and compares a non-padded date as text), and reached the iCal export as an invalid
   event. One guard, `utils/stayDates.stayDatesRefusal(startDate, endDate)`, now requires each date to
   match `YYYY-MM-DD` and to be a real calendar day (UTC round-trip), and the departure to follow the
   arrival. Otherwise 400 `{ error, code: 'INVALID_STAY_DATES', field }`, with `error` « Date de séjour
   invalide. » (shape or day) or « La date de départ doit suivre la date d'arrivée. » (order), before
   pricing, availability or any write. It runs on: `POST /reservations` (`createStay`, with or without a
   draft client), `PUT /reservations/:id` and every server caller of `performUpdate` (plugins, intakes),
   `POST /reservations/calculate-price`, `POST /reservations/:id/restore` (on the stored dates),
   `POST /dashboard/ical-date-drift/:id/approve` (on the proposed dates; the alert stays pending, so
   « Rejeter » still clears it), and in `devisModel` on create, update (the dates the save would store),
   extension preview and extension (stored dates), and conversion into a reservation (stored dates).
   The payment `PATCH` carries no dates and is not checked. The iCal **import** needs no guard and is
   unchanged: the parser already drops an event whose date is not a real day and turns a reversed or
   zero-night event into one night (`specs/ical-import-hardening.md` rule 17, F9), so a sync is never
   refused for a feed's odd dates. A check of the prod snapshot of 2026-10-22 found no stored row with
   such dates, so there is no data migration.
   *Reading of 2026-11-02 (audit R19-L1) — a stay lasts at most 366 nights.* The guard also refuses a
   departure more than `MAX_STAY_NIGHTS` (366) nights after the arrival: 400 `INVALID_STAY_DATES`, `field`
   `endDate`, `error` « Séjour trop long. », on every path listed above and before any pricing. Pricing walks
   the stay night by night, synchronously, before the availability check: a departure typed as `9999-12-31`
   on `POST /reservations/calculate-price` took ~100 s and blocked every other request of the server
   meanwhile (the fiche quotes on every date change, so a year typed digit by digit reached it). 366 is the
   iCal parser's length cap (`specs/ical-import-hardening.md` rule 17), and the two share the one constant
   `utils/stayDates.MAX_STAY_NIGHTS`, so an imported event and an internal write obey the same bound. The
   public booking path keeps its own, tighter caps. The prod snapshot of 2026-10-22 (read on a copy) stores
   no stay longer than 14 nights, so no stored row or legitimate flow is refused.
12. **Added 2026-11-02 (audit R18-1) — the fiche says it before the save.** The fiche (reservation and
   devis, both `ReservationPage`) shows « La date de départ doit suivre la date d'arrivée. » in red under
   the dates, the departure field in error, as soon as the departure is on or before the arrival; and
   « Enregistrer » refuses with that message in the usual error dialog, sending nothing. A refusal of
   the server (rule 11) reaches the same dialog with its own message. The `min` of the departure field
   only styled a typed value: it never stopped the save. Switching the logement asks for a quote only
   when the stay is complete and ordered: a « Nouveau devis » switched before its dates are typed has
   no quote yet, as on opening (it used to price an empty range at 0 €, which rule 11 now refuses).
   *Reading of 2026-11-02 (audit R19-L1).* A departure more than 366 nights after the arrival shows
   « Séjour trop long. » in the same place, the departure field in error, and « Enregistrer » refuses with
   it. Such a range is never quoted: not by the live quote on a date change, not by the logement switch,
   not on opening from URL dates. `utils/stayDates.stayDatesMessage` gives the one hint (order, then
   length) and `isQuotableStay` the quote gate; the message and the 366 live in `constants/stayDates.js`,
   mirroring the server.
13. **Added 2026-11-02 (Adrien's decision) — no date is entered past the horizon.** No date may be entered
   more than `MAX_HORIZON_YEARS` = 5 years ahead: the last allowed day is today (the Europe/Paris day,
   `utils/localDate.todayIso`) plus 5 years, a 29 February landing on the 28th
   (`utils/stayDates.horizonEnd`, `dateBeyondHorizon`). One day past it is refused with « Date trop
   lointaine : 5 ans au plus. ». It is checked inside `stayDatesRefusal`, after rule 11's shape, order and
   length checks, so it runs on every path rule 11 lists: 400 `INVALID_STAY_DATES`, `field` naming the
   first date past it. The same message refuses a closure (`specs/establishment-closures.md` rule 18,
   reading of 2026-11-02) and the end of a finance custom window (`specs/finance-dashboard-redesign.md`
   rule 51, reading of 2026-11-02). The past is not limited: history stays. The duration caps stay as
   they are: a stay 366 nights, a closure 731, a finance window 750 days.
   **Only an entered or edited date is held to it.** `stayDatesRefusal(start, end, { stored })` skips a
   date equal to the stored row's: a row written before this rule, past the horizon, still saves while its
   dates are not edited (`PUT /reservations/:id` and `performUpdate` compare with the stored row,
   `calculate-price` with the row of its `reservationId` or `devisId`, a devis update with the stored
   devis). The paths that enter no date never refuse on it: a restore of a duplicate set aside, a devis
   extension and its preview, a devis converted into a reservation (stored dates). An iCal date drift
   approved is held to it on the dates it changes. Read paths never refuse a stored row: the occupied
   dates and the planning reads keep only their 750-day span cap (`specs/establishment-closures.md` rule
   20), since the calendar and the planning are navigated, not typed, and must still show a stored row
   past the horizon. The iCal **import** keeps its own 730-day horizon (`specs/ical-import-hardening.md`),
   inside this one. The tariff recipes write their closures and seasons through their own model, not
   through these validators (`horizonYears` ≤ 5 counted from the current year), so a recipe never
   breaks; a recipe closure ending past the horizon stays editable as long as its dates are kept.
   A copy of the prod snapshot of 2026-10-22 (read 2026-11-02 against a horizon of 2031-11-02) stores no
   stay, devis or closure ending past it — the latest are a reservation ending 2027-08-13, a devis 2027-04-16
   and a closure 2028-03-31 — so nothing is migrated. The GreenGo block of 2028-03-01 → 2028-08-29, which
   reaches GuestFlow through the iCal import, is inside the horizon and the import is not held to it anyway.
   The fiche and the devis (`ReservationPage`) show the message under the dates, the field in error, ask
   neither a quote nor the occupied dates for such a range, and « Enregistrer » refuses with it before any
   request; a date the record was loaded with is not held to it (`utils/stayDates.stayDatesMessage(start,
   end, { stored })`). The horizon and its message live in `constants/dateHorizon.js` and
   `utils/dateHorizon.js`, mirroring the server. *Why:* a year typed one digit off (2062 for 2026) used to
   be accepted, and nothing the operator manages is booked or closed five years ahead. Tests:
   `tests/date-horizon.unit.test.js`, client `ReservationPage.date-horizon.test.jsx`.

**Edge cases:** all current ones are preserved verbatim — min-nights rejection, archived-reservation
error, iCal-locked pricing snapshot reuse, night-block conflict on adjacent reservations, payment
patch. No new edge behavior is introduced.

---

## 4. Architecture

> Pure backend restructure. Fat backend stays fat; the client is not touched.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `reservations.js` | T | Thin wiring only: verb/path → controller method. Multer/JSON middleware stays. Target: ~60–90 LOC. |
| `controllers/` | `reservationsController.js` | C | One handler per endpoint: parse → finance validation → pricing (`utils/pricing`) → occupancy (`utils/occupancy`) → model → response. Holds the orchestration currently inline in the routes. |
| `models/` | `reservationsModel.js` | C | Factory `create(db)` (+ default bound to `../database`), mirroring `settingsModel`. Methods: `list({propertyId,clientId,from,to})`, `getById(id)` (with options/resources/nights), `getHistory(id)`, `create(payload)`, `update(id,payload)`, `updatePayment(id,payload)`, `remove(id)`, `getPricingSnapshot(id)`, `listForOccupancy(propertyId,from,to,excludeId)`, history insert. All SQL lives here. |
| `utils/` | `occupancy.js` | C | Pure: `timeToHour`, `addIsoDays`, `getNightBlocksFromTimes`, `buildOccupiedDatesFromReservations`, `validateAvailability({...})` (the current `validateReservation` rule, DB-free — takes the candidate + existing reservations/closures). Unit-tested. |
| `utils/` | `reservationAudit.js` | C | Pure: `normalizeHistoryValue`, `getOptionsSignature`, `getResourcesSignature`, `buildAuditSnapshotFromPayload`, `computeAuditChanges`. Snapshot-from-DB stays a model read that feeds these pure fns. Unit-tested. |
| `utils/` | `pricing.js` | — | Unchanged; controller calls `calculateReservationQuote` as today. |
| `utils/` | `financeValidation.js` | — | Unchanged; controller keeps the PR-S validation on writes. |
| `utils/` | `stayDates.js` | C | *(2026-11-02, rule 11)* `isRealIsoDay`, `stayDatesRefusal`, `stayDatesRefusalBody`: the one stay-dates guard, called by `reservationsController`, `devisModel` and `icalDateDriftModel`. `isRealIsoDay` is also the core's one real-day check: `planningDateRange.isIsoDate` and `cancellationCompensations.isValidIsoDate` are it. *(R19-L1)* `MAX_STAY_NIGHTS` (366), the length cap, also read by `icalParser`'s horizon check. *(rule 13)* `MAX_HORIZON_YEARS`, `HORIZON_MESSAGE`, `horizonEnd`, `dateBeyondHorizon` and the `stored` option of `stayDatesRefusal`: the date horizon, also read by `establishmentClosuresValidation` and `financeWindow`. |
| `database.js` | — | — | No schema change. |

**Notes:**
- `validateReservation` currently queries the DB inside itself; split it into a **pure** rule
  (`utils/occupancy.validateAvailability`, fed data) + a **model** read (`listForOccupancy`) so the rule
  is unit-testable. Establishment-closure overlap (already consulted via `establishmentClosuresModel`)
  stays wired in the controller/model exactly as now.
- Keep `calculate-price` and `suggest-beds` behavior identical (move their inline bodies into controller
  methods; bed-distribution math → a pure helper, optionally in `occupancy.js` or its own util).
- Model uses better-sqlite3 prepared statements (created once in the factory), like `settingsModel`.

### 4.2 Client side

None. `utils/reservationConflicts.js` and its consumers are unchanged.

*2026-11-02 (rule 12):* `pages/ReservationPage.jsx` refuses the save and exposes `stayDatesHint`;
`components/reservation/StaySection.jsx` renders it under the dates; the messages and `MAX_STAY_NIGHTS`
live in `constants/stayDates.js`, and `utils/stayDates.js` holds `stayDatesMessage` / `isQuotableStay`
(R19-L1, the length cap).

*2026-11-02 (rule 13):* `constants/dateHorizon.js` (`MAX_HORIZON_YEARS`, `HORIZON_MESSAGE`) and
`utils/dateHorizon.js` (`horizonEnd`, `dateBeyondHorizon`, generic: the fiche, the closures dialog and
`PeriodSelector` read them); `stayDatesMessage` / `isQuotableStay` take the loaded record as `stored`, and
the fiche's occupied-dates read is gated by `isQuotableStay` too.

### 4.3 API contract

**Unchanged.** Same endpoints, bodies, responses, and status codes as today. This slice must be a no-op
from any API client's perspective (verified by the existing behavior + manual checks).

*2026-11-02 (rule 11):* the stay endpoints listed in rule 11 answer 400 `INVALID_STAY_DATES` (`error`,
`code`, `field`) for unsound dates, the devis endpoints and the iCal drift approval included (both
now forward `code` and `field` with their `error`).

*2026-11-02 (rule 13):* the same 400 `INVALID_STAY_DATES`, `error` « Date trop lointaine : 5 ans au plus. »,
for an entered or edited date past today + 5 years. No new field: `calculate-price` already carried
`reservationId` / `devisId`.

---

## 5. Data model

No schema changes. No migration.

**Data impact:** none — pure code restructure.

## 6. UI / UX

No UI changes. (Manual verification still exercises the reservation flows through the existing client to
prove behavior is preserved.)

## 7. Test plan

### Server unit tests
- [x] `tests/date-horizon.unit.test.js` (12, 2026-11-02) — rule 13: today + 5 years accepted, one day more
      refused on calculate-price, create, update, drift approval, devis create / update, closures and the
      finance window; stored dates past the horizon saved, restored, extended and converted untouched.
- [ ] `tests/occupancy.unit.test.js` — `getNightBlocksFromTimes` thresholds (checkout ≥17h blocks next
      night, checkin ≤10h blocks previous night); `buildOccupiedDatesFromReservations`;
      `validateAvailability` accepts a free range and rejects overlaps incl. night-block adjacency.
- [ ] `tests/reservation-audit.unit.test.js` — option/resource signatures; `computeAuditChanges`
      detects changed fields and ignores unchanged ones; value normalization.
- [ ] Model (`reservationsModel`) is verbatim SQL extraction; verified end-to-end via the manual
      round-trip below (create / conflict / history / delete) rather than a duplicate in-memory schema
      test. The existing suite stays green (no behavior change).

### Manual verification (behavior preserved)
- [ ] Create a reservation (happy path) → saved with options/resources/nights + a `create` history entry.
- [ ] Edit it → updated + an `update` history entry with the right diff; pricing snapshot honored on edit.
- [ ] Conflict: try to create overlapping/adjacent (night-block) reservation → rejected with the same message.
- [ ] Min-nights breach → same rejection.
- [ ] `PATCH payment` → flags/amounts update; `DELETE` → removed; archived-reservation error unchanged.
- [ ] `GET /occupied-dates` and `GET /:id/history` return the same shapes as before.
- Audit R18-1 (rules 11-12, 2026-11-02): `server/src/tests/stay-dates-guard.unit.test.js` (30 cases: the four
  shapes on reservation create / update / `performUpdate` / calculate-price / devis create / update, stored
  dates on devis extend / preview / convert, restore and drift approval, each asserting `code` and `field`; the
  parser contract) and
  `client/src/pages/__tests__/ReservationPage.stay-dates-order.test.jsx` (5 cases: reservation, zero night,
  devis, server refusal, logement switch before the dates).
- Audit R19-L1 (rules 11-12, 2026-11-02): `server/src/tests/stay-length-cap.unit.test.js` (12 cases: the cap
  itself; a `9999-12-31` departure and a 367-night stay refused in under 500 ms on calculate-price, reservation
  create and update, devis create and update, nothing written; 366 nights quoted and saved) and
  `client/src/pages/__tests__/ReservationPage.stay-length.test.jsx` (5 cases: the pure hint, 367 nights and
  `9999-12-31` on the fiche with no quote and no save, 366 nights quoted, the devis).
- Spec review 2026-10-27 (rule 9): `server/src/tests/create-without-times-and-linen.unit.test.js` — default times stored, no early-arrival fee on the re-save.

## 8. Out of scope

- **Moving `reservationConflicts.js` rules server-side / returning `conflictType` flags** → deferred to
  the client slices **3b (CalendarPage)** / **3c (ReservationPage)**, where those consumers are
  refactored; changing the conflict-info source is a client+UX concern best done there. The server is
  already authoritative for rejection today, so deferring is safe.
- **CalendarPage dead-dialog removal** → slice **3b**.
- **ReservationPage component split + PageActionBar** → slice **3c**.
- **Devis MVC refactor / table fusion** → Bloc 4. (`devis.js` shares the pricing engine but is not
  touched here beyond what PR-S already did.)
- Any change to pricing math, payment schedule, or tourist tax (owned by `utils/pricing.js`).

## 9. Open questions

**Resolved at approval (2026-05-27):**
- `suggestBedDistribution` → its own `utils/bedDistribution.js` (distinct concern, unit-testable). ✅
