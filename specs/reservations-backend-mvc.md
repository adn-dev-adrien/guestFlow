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
7. **No client change.** The 3 client consumers (`CalendarPage`, `ReservationPage`, `MiniPlanningStrip`)
   and their UX helper `utils/reservationConflicts.js` are untouched here (see Out of scope).
8. **Tests.** The extracted occupancy + audit utils and the model get unit tests; the existing suite
   stays green.

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

### 4.3 API contract

**Unchanged.** Same endpoints, bodies, responses, and status codes as today. This slice must be a no-op
from any API client's perspective (verified by the existing behavior + manual checks).

---

## 5. Data model

No schema changes. No migration.

**Data impact:** none — pure code restructure.

## 6. UI / UX

No UI changes. (Manual verification still exercises the reservation flows through the existing client to
prove behavior is preserved.)

## 7. Test plan

### Server unit tests
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
