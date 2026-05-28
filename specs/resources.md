# Resources & resource bookings — MVC + applicability pivot + safe delete

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/resources` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 1 — Clients & Resources (spec 2 of 2: Resources). See `specs/ROADMAP.md`. |

---

## 1. Context

`routes/resources.js` (322 LOC) and `routes/resourceBookings.js` (229 LOC) hold all logic inline with no
controller/model. The real domain logic is **already server-side** — per-property price/freeMinutes
resolution, availability (overlap against `reservation_resources`), slot-conflict (turnover) detection,
and `computeBookingTotalPrice` — it's just not in models. The pages are mostly **layout math**
(`ResourcePlanningPage` renders a time-grid; `ResourcesPage` is the shared `PricedItemsPage` scaffold), so
little client change is needed.

Two structural issues:
- **`resources.propertyIds` (which logements a resource applies to) is a denormalized JSON column.**
  Options already model the equivalent association with a **`property_options` pivot** — so resources are
  the odd one out. Per-property *prices* already live in the `property_resource_prices` pivot.
- **Deleting a resource is silent and destructive.** FK cascade removes the resource from existing
  reservations (`reservation_resources`) and deletes all its `resource_bookings` — with no warning (only
  baby-bed resources are protected, client-side, by name).

## 2. Goal

Make the resource domain a clean thin-route → controller → model stack, normalize resource↔property
applicability into a pivot (consistent with options), and warn before a destructive resource delete. The
server stays the single source of truth; the pages keep only layout/render logic. No visible change
except the delete confirmation now states the impact.

## 3. Functional rules

1. **MVC.** `routes/resources.js` and `routes/resourceBookings.js` become thin. Orchestration in
   `resourcesController` / `resourceBookingsController`; all DB access + shaping (parse, pricing
   resolution, availability, slot-conflict, booking price) in `resourcesModel` / `resourceBookingsModel`.
2. **Applicability pivot.** Replace `resources.propertyIds` JSON with a `resource_properties` pivot
   (`resourceId`, `propertyId`). The API still exposes `propertyIds` (array, rebuilt from the pivot) so
   `ResourcesPage` is unchanged. Empty pivot = global (applies to all logements), same semantics as today.
3. **All applicability consumers read the pivot** (no JSON parsing left): resources list/availability,
   baby-bed availability (`resourcesModel` + `reservationsModel`), the pricing engine
   (`utils/pricing.js` resource filter), and the baby-bed seed in `database.js`.
4. **Create/Update** replace the resource's `resource_properties` rows and its `property_resource_prices`
   rows atomically (transaction), validate inputs (name required; quantity/price/freeMinutes
   non-negative numbers; reject otherwise with `400`). Normalization (`sentenceCase`) stays.
5. **Availability, price resolution and slot-conflict** are unchanged in behavior, moved verbatim into
   the model. `resource_bookings` price stays **server-computed** (`computeBookingTotalPrice`), never
   trusted from the client.
6. **Resource deletion impact + confirmation.** `GET /resources/:id/delete-impact` returns counts +
   short lists of the **reservations** (via `reservation_resources`) and **bookings** (via
   `resource_bookings`) that reference the resource. `DELETE /resources/:id` returns `409 RESOURCE_IN_USE`
   (with the counts) when either is non-empty; `?force=true` deletes it (FK cascade removes the resource
   lines from those reservations + the bookings). Baby-bed resources stay protected (client-side disable,
   unchanged).
7. **Pages render only.** `ResourcesPage` (via `PricedItemsPage`) and `ResourcePlanningPage` keep their
   layout/positioning math; no business rule moves to the client. The delete flow shows the impact
   (counts) before forcing.

**Edge cases:**
- Resource with no reservation/booking → plain confirm, deletes directly (no `409`).
- Global resource (empty pivot) → still applies to every logement; availability/pricing unchanged.
- Baby-bed resources → still blocked from deletion in the UI; availability special-case preserved.
- Per-hour booking price (freeMinutes, turnover slot-conflict) → identical results after the move.

---

## 4. Architecture

> **Fat backend, thin frontend.** Pricing, availability, conflict detection and impact aggregation are
> server-side (moved into models). The pages render server payloads + pure layout math.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/` | `resources.js` | T | Thin: parse → `resourcesController` → respond. |
| `routes/` | `resourceBookings.js` | T | Thin: parse → `resourceBookingsController` → respond. |
| `controllers/` | `resourcesController.js` | C | list / availability / baby-bed-availability / get / create / update / delete(+force) / delete-impact; `400/404/409 RESOURCE_IN_USE`. |
| `controllers/` | `resourceBookingsController.js` | C | planning-events / occupied-slots / list / get / create / update / delete; `400/404/409`. |
| `models/` | `resourcesModel.js` | C | `resources` + `resource_properties` + `property_resource_prices` access; parse, applicability (pivot), price/freeMinutes resolution, availability, baby-bed availability, CRUD, delete-impact. Returns API-shaped objects (incl. `propertyIds` array). `create(db)` factory. |
| `models/` | `resourceBookingsModel.js` | C | `resource_bookings` access: joined reads, slot-conflict count (turnover), `computeBookingTotalPrice`, CRUD. `create(db)` factory. |
| `utils/` | `resourcePropertyMigration.js` | C | Pure, unit-tested: backfill `resource_properties` from the `propertyIds` JSON, then drop the column; idempotent. |
| `utils/` | `pricing.js` | T | Resource applicability filter reads `resource_properties` instead of `resource.propertyIds` JSON. |
| `models/` | `reservationsModel.js` | T | Baby-bed availability reads applicability from the pivot. |
| `database.js` | `database.js` | T | Create `resource_properties` (+ index); call `migrateResourcePropertiesFromJson`; baby-bed seed/global check uses the pivot; drop `propertyIds` from the `resources` `CREATE TABLE`. |
| `utils/` | `textFormatters.js` | — | Reused (`sentenceCase`). |

**No new dependency.**

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `PricedItemsPage.js` | T | Optional `getDeleteImpact(id)` prop: when provided and the item is in use, the delete confirmation states the impact (counts) and deletes with `force`; otherwise the current plain confirm. Options page unaffected (prop omitted). |
| `pages/` | `ResourcesPage.js` | T | Pass `getDeleteImpact` + a force-capable `deleteItem`; otherwise unchanged (still renders `propertyIds` array). |
| `services/` | `api.js` | T | `getResourceDeleteImpact(id)`; `deleteResource(id, { force })`. |
| `pages/` | `ResourcePlanningPage.js` | — | Unchanged (layout math only). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PricedItemsPage` (extended with an optional impact hook), `useAppDialogs().confirm` | The impact is shown via the existing confirm (count summary) — no new dialog component. |
| **Created (new generic)** | (none) | — |

### 4.3 API contract

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/resources` (`?propertyId`) | unchanged shape (`propertyIds` array, `price`, `freeMinutes`, `propertyPricing`). |
| GET | `/resources/availability` | unchanged. |
| GET | `/resources/baby-bed-availability` | unchanged. |
| GET | `/resources/:id` | unchanged. |
| GET | `/resources/:id/delete-impact` | **new** → `{ resource, reservationsCount, reservations[], bookingsCount, bookings[] }`. |
| POST/PUT | `/resources` `/resources/:id` | add input validation (`400`). |
| DELETE | `/resources/:id?force=` | `409 RESOURCE_IN_USE` (+counts) when in use; `force` cascades. |
| * | `/resource-bookings/*` | unchanged behavior (now controller/model). |

Auth: all under the global `requireAuth` guard (unchanged).

---

## 5. Data model

**New table** (mirrors `property_options`):
```sql
CREATE TABLE IF NOT EXISTS resource_properties (
  resourceId INTEGER NOT NULL,
  propertyId INTEGER NOT NULL,
  PRIMARY KEY (resourceId, propertyId),
  FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
  FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resource_properties_resourceId ON resource_properties(resourceId);
```

**Migration (idempotent, in `database.js`), guarded by `propertyIds` column existence:**
1. Create the table + index.
2. Backfill: for each resource, insert one `resource_properties` row per id in its `propertyIds` JSON
   (skip empty/global → no rows = global, preserving semantics).
3. `ALTER TABLE resources DROP COLUMN propertyIds`.

**Data impact:** applicability is moved, not lost (empty/global stays global). Documented as a `Migration`
note in `CHANGELOG.md`. The drop is irreversible but lossless given the backfill.

## 6. UI / UX

- **Resources list/form:** unchanged (still shows/edits the logements a resource applies to; the array
  round-trips through the API).
- **Delete a resource in use:** the confirmation states the impact, e.g. *« Cette ressource est utilisée
  dans 3 réservation(s) et 5 créneau(x). La supprimer la retirera de ces réservations et supprimera ces
  créneaux. Continuer ? »* → on confirm, force-delete. Unused resource → plain confirm. Baby-bed → still
  not deletable.
- **Responsive:** unchanged (no new layout).

## 7. Test plan

### Server unit tests
- [x] `resources-model.unit.test.js` (6) — applicability via pivot (global vs scoped); effective price +
      freeMinutes (base vs per-property override); availability (overlap); CRUD replaces pivot + price
      rows; delete-impact (reservations + bookings counts).
- [x] `resource-bookings-model.unit.test.js` (6) — `computeBookingTotalPrice` (per_hour w/ freeMinutes,
      per_stay, free); min-usage; slot-conflict (409) with non-overlap allowed; `404`.
- [x] `resources-controller.unit.test.js` (8) — `400` invalid input; `404`; `409 RESOURCE_IN_USE` when
      reservations or bookings exist; `force` deletes; availability requires dates.
- [x] `resource-property-migration.unit.test.js` (3) — backfill maps JSON → rows; global stays global;
      stale ids skipped; idempotent.
- [x] Existing `pricing` + reservations/baby-bed suites stay green after the pivot switch. **Full suite: 297.**

### Manual UI verification (in browser)
- [x] Resources list renders ("Tous les logements" via the empty pivot); baby-bed delete disabled;
      `0` console errors.
- [x] Delete an in-use resource ("Bain nordique") → impact-count confirm
      ("5 réservation(s) et 1 créneau(x)…"); cancel is non-destructive.
- [x] Clean `CI=true` client build.
- [ ] Create/edit a scoped resource end-to-end, booking create/edit, mobile (`xs`) — not exercised to
      avoid mutating data; left for the user's pass.

## 8. Out of scope

- Redesigning the **baby-bed** special-case (name-based detection + `reservations.babyBeds`) — moved into
  the model as-is.
- **Options** (`property_options` already a pivot) — untouched beyond sharing `PricedItemsPage`.
- `ResourcePlanningPage` visual rework; drag-create behavior changes.

## 9. Open questions

- Q: Delete-impact as a **count summary** in the confirm (proposed) or a detailed list dialog like the
  clients page? — A (proposed): count summary, since resources use the shared `PricedItemsPage` scaffold
  (a bespoke list dialog there is heavier for little gain). Confirm at validation.
