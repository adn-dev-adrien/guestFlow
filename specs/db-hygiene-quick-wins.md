# DB Hygiene Quick Wins

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/db-hygiene-quick-wins` _(user-managed)_ |
| **Created** | 2026-05-25 |
| **Author** | Adrien |
| **Spec type** | Cross-cutting DB refactor (no UI / no business logic change) |

---

## 1. Context

A full DB schema audit was performed on `server/src/database.js` (~1319 LOC, 28 tables). Findings:

- **29 foreign keys with zero index** (apart from 1 existing index on `property_resource_prices`). Every `WHERE propertyId = ?`, `WHERE reservationId = ?`, etc. performs a full table scan today.
- **`resources` table has two ways to express its property scope**: `propertyId` (single FK, used only for the `IS NULL = global` check at [routes/resources.js:168](server/src/routes/resources.js#L168)) AND `propertyIds` (JSON array, used everywhere else for read/write). Sources of confusion and inconsistent data.
- **No `UNIQUE` on `resource_bookings (resourceId, date, startTime, endTime)`** — race conditions could create double-bookings.
- **No `UNIQUE` on `ical_sources (propertyId, platformKey)`** — same iCal source could be added twice for the same property.
- **Critical iCal lookups have no dedicated index** (see §1.1 below).

### 1.1 The iCal anti-overbooking contract (do NOT regress)

GuestFlow ingests reservations from external platforms (Airbnb, Booking, Abritel, etc.) via iCal sources. **Avoiding double-bookings on the same night** is a core feature.

The challenge: external platforms can change an event's iCal `UID` between two syncs. If we naively re-create reservations whose `UID` changed, we would have **duplicate reservations on the same night** — exactly what GuestFlow is supposed to prevent. We also need to remember which reservations came from iCal vs. were created manually, and which have been manually edited by the user (so we don't overwrite their changes on the next sync).

The existing schema already supports this contract:

| Column | Table | Purpose | Status |
|---|---|---|---|
| `sourceType` | `reservations` | `'manual'` or `'ical'` | **DO NOT DROP — critical** |
| `sourcePlatformKey` | `reservations` | `'airbnb'`, `'booking'`, etc. for iCal-sourced reservations | **DO NOT DROP — critical** |
| `sourceIcalSourceId` | `reservations` | FK to `ical_sources` for iCal-sourced reservations | **DO NOT DROP — critical** |
| `sourceIcalEventUid` | `reservations` | iCal `UID` at creation time (may become stale) | **DO NOT DROP — critical** |
| `icalSyncLocked` | `reservations` | `1` once the user manually edits an iCal-sourced reservation — subsequent syncs do not overwrite it | **DO NOT DROP — critical** |
| `blocksPreviousNight` / `blocksNextNight` | `reservations` | Night-block flags driven by check-in/out times | **DO NOT DROP — critical** |
| `eventHash` | `ical_import_events` | Detects whether an iCal event payload changed between syncs (skip update if unchanged) | **DO NOT DROP — critical** |
| `startDate`, `endDate`, `summaryNormalized` | `ical_import_events` | Fallback fingerprint to re-match an event whose `UID` changed | **DO NOT DROP — critical** |

The sync algorithm (in `routes/properties.js`) works in this order for each incoming iCal event:

1. **Primary lookup**: `SELECT reservationId FROM ical_import_events WHERE sourceId=? AND eventUid=?` (the table's `PRIMARY KEY`, already indexed).
2. **Fallback lookup** (if `UID` changed and primary returns nothing): `SELECT ... FROM ical_import_events WHERE sourceId=? AND startDate=? AND endDate=? AND summaryNormalized=?` — uses the existing `idx_ical_import_events_fallback` index. If a match is found, the entry's `eventUid` is rewritten to the new value and the reservation is kept.
3. If both lookups fail, a **new reservation is created** along with a new `ical_import_events` row + a new auto-created client.
4. If `reservations.icalSyncLocked = 1`, the reservation is **not modified** (the user's manual edits win).
5. Bidirectional lookup is also needed: when a reservation is deleted in GuestFlow, the corresponding `ical_import_events` row must be efficiently locatable by `reservationId` to keep the mapping consistent.

This spec **adds the missing index for step 1's reverse direction** (`reservations(sourceIcalSourceId, sourceIcalEventUid)`, used to find a reservation by source + UID without a table scan) and **the missing index for step 5** (`ical_import_events(reservationId)`, used for reverse lookup when a reservation is deleted).

### 1.2 What is out of scope

Other findings (dead columns, CHECK constraints on enums, JSON blob normalization, devis/reservation table fusion, 103 inline migrations consolidation) are **out of scope for this spec** — they will be addressed either in a follow-up DB spec or, more often, alongside the feature-specific retro-specs that touch them (cf. CLAUDE.md refactoring policy).

This spec is the **Bloc 0** — a sweep of safe, low-risk improvements that make the schema faster and less ambiguous before we start adding new tables and features.

## 2. Goal

After this spec:
1. **Reads on foreign-keyed columns are indexed** — measurable perf improvement on every `WHERE <fk> = ?` query.
2. **Race-condition risks** (double resource bookings, duplicate iCal sources) are blocked at the DB level by `UNIQUE` constraints.
3. **iCal anti-overbooking lookups are indexed in both directions** — `reservations → ical_import_events` (delete propagation) and `(sourceIcalSourceId, sourceIcalEventUid) → reservations` (sync primary lookup).
4. **`resources` has a single source of truth** for property scoping (`propertyIds` JSON kept; `propertyId` single FK removed).
5. **The iCal source-tracking columns on `reservations` are documented as critical** (cf. §1.1) — no future spec should remove them.
6. **No regression** anywhere — all 127 existing server tests stay green; the app boots and behaves identically.

## 3. Functional rules

### Indexes

1. Add `CREATE INDEX IF NOT EXISTS` for every FK column that is filtered/joined in routes (see §5 for the full list).
2. All `CREATE INDEX` statements are idempotent; safe to run on every startup.

### UNIQUE constraints

3. Add a unique constraint on `resource_bookings (resourceId, date, startTime, endTime)` to prevent double-bookings of the same time slot.
4. Add a unique constraint on `ical_sources (propertyId, platformKey)` to prevent duplicate iCal sources for the same property.
5. Constraints are implemented as **`CREATE UNIQUE INDEX IF NOT EXISTS`** (not `ALTER TABLE ADD CONSTRAINT` — SQLite doesn't support the latter in-place, and `UNIQUE INDEX` is functionally equivalent for our purposes).
6. **Before applying each unique index, run a duplicate detection query** — if duplicates exist, log a warning and skip the index creation (don't crash the boot). The user can clean up data manually and restart. This is the safe path; a strict approach would lose existing rows.

### Resources `propertyId` cleanup

7. The `resources.propertyId` (single FK to `properties(id)`) column is **removed**.
8. The semantics "this resource is global" become: `propertyIds` JSON is `null` or `'[]'`.
9. The route logic [routes/resources.js:168](server/src/routes/resources.js#L168) (`r.propertyId === null`) becomes: `!resource.propertyIds || resource.propertyIds.length === 0`.
10. Migration: data already follows this convention in practice; the column is rarely written. Verify via grep + a count query at startup; if any row has `propertyId != null` AND non-empty `propertyIds`, log a warning (pick `propertyIds`).

### Edge cases

- Boot on a fresh DB: all indexes are created as part of the normal schema bootstrap.
- Boot on an existing DB: all indexes are created idempotently; duplicate detection runs before unique indexes; the `propertyId` column drop is wrapped in a try/catch (it may already be gone after the first run).

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** No UI change; this is a pure backend hygiene pass.

### 4.1 Server side (`server/src/`)

#### Files touched

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | Append a new "Indexes & constraints" section after the existing migrations block. Add a small `removeResourcesPropertyIdColumn()` helper that runs once. |
| `routes/resources.js` | `routes/resources.js` | T | Single change at line ~168: replace `r.propertyId === null` with `!r.propertyIds || (Array.isArray(r.propertyIds) && r.propertyIds.length === 0)`. |
| `utils/dbHealth.js` | _(optional, see below)_ | C | If we keep duplicate detection, it can live in a small util `checkDuplicatesBeforeUnique(db, table, columns)` for readability. Otherwise inlined in `database.js`. |

#### No new MVC layers

This is a schema-only spec; no controller, no model, no validator. The work is in `database.js` (the schema source of truth).

### 4.2 Client side

**Nothing changes.** The API contracts are unchanged. The client doesn't know about indexes or DB constraints.

### 4.3 API contract

**Unchanged.** No endpoint signature changes. Body shapes preserved.

## 5. Data model

### Indexes to create

All as `CREATE INDEX IF NOT EXISTS`:

```sql
-- pricing_rules
CREATE INDEX IF NOT EXISTS idx_pricing_rules_propertyId ON pricing_rules(propertyId);

-- documents
CREATE INDEX IF NOT EXISTS idx_documents_propertyId ON documents(propertyId);

-- property_options (pivot)
CREATE INDEX IF NOT EXISTS idx_property_options_propertyId ON property_options(propertyId);
CREATE INDEX IF NOT EXISTS idx_property_options_optionId ON property_options(optionId);

-- reservations
CREATE INDEX IF NOT EXISTS idx_reservations_propertyId ON reservations(propertyId);
CREATE INDEX IF NOT EXISTS idx_reservations_clientId ON reservations(clientId);
CREATE INDEX IF NOT EXISTS idx_reservations_startDate ON reservations(startDate);

-- reservation_options / reservation_custom_options / reservation_resources / reservation_nights / reservation_history
CREATE INDEX IF NOT EXISTS idx_reservation_options_reservationId ON reservation_options(reservationId);
CREATE INDEX IF NOT EXISTS idx_reservation_options_optionId ON reservation_options(optionId);
CREATE INDEX IF NOT EXISTS idx_reservation_custom_options_reservationId ON reservation_custom_options(reservationId);
CREATE INDEX IF NOT EXISTS idx_reservation_resources_reservationId ON reservation_resources(reservationId);
CREATE INDEX IF NOT EXISTS idx_reservation_resources_resourceId ON reservation_resources(resourceId);
CREATE INDEX IF NOT EXISTS idx_reservation_nights_reservationId ON reservation_nights(reservationId);
CREATE INDEX IF NOT EXISTS idx_reservation_history_reservationId ON reservation_history(reservationId);

-- resource_bookings
CREATE INDEX IF NOT EXISTS idx_resource_bookings_resourceId ON resource_bookings(resourceId);
CREATE INDEX IF NOT EXISTS idx_resource_bookings_reservationId ON resource_bookings(reservationId);
CREATE INDEX IF NOT EXISTS idx_resource_bookings_propertyId ON resource_bookings(propertyId);
CREATE INDEX IF NOT EXISTS idx_resource_bookings_date ON resource_bookings(date);

-- devis (mirror of reservations indexing pattern)
CREATE INDEX IF NOT EXISTS idx_devis_propertyId ON devis(propertyId);
CREATE INDEX IF NOT EXISTS idx_devis_clientId ON devis(clientId);
CREATE INDEX IF NOT EXISTS idx_devis_status ON devis(status);
CREATE INDEX IF NOT EXISTS idx_devis_options_devisId ON devis_options(devisId);
CREATE INDEX IF NOT EXISTS idx_devis_options_optionId ON devis_options(optionId);
CREATE INDEX IF NOT EXISTS idx_devis_custom_options_devisId ON devis_custom_options(devisId);
CREATE INDEX IF NOT EXISTS idx_devis_resources_devisId ON devis_resources(devisId);
CREATE INDEX IF NOT EXISTS idx_devis_resources_resourceId ON devis_resources(resourceId);
CREATE INDEX IF NOT EXISTS idx_devis_nights_devisId ON devis_nights(devisId);
CREATE INDEX IF NOT EXISTS idx_devis_history_devisId ON devis_history(devisId);

-- ical
CREATE INDEX IF NOT EXISTS idx_ical_sources_propertyId ON ical_sources(propertyId);
CREATE INDEX IF NOT EXISTS idx_ical_tokens_propertyId ON ical_tokens(propertyId);

-- iCal anti-overbooking lookups (see §1.1)
-- Primary sync lookup: find the existing reservation for an incoming iCal event.
CREATE INDEX IF NOT EXISTS idx_reservations_ical_source ON reservations(sourceIcalSourceId, sourceIcalEventUid);
-- Reverse lookup: when a reservation is deleted, find its ical_import_events row.
CREATE INDEX IF NOT EXISTS idx_ical_import_events_reservationId ON ical_import_events(reservationId);

-- calendar_notes (composite with date is more useful than propertyId alone for the common WHERE)
CREATE INDEX IF NOT EXISTS idx_calendar_notes_propertyId_date ON calendar_notes(propertyId, date);
```

### Unique constraints to add (as unique indexes)

```sql
-- Prevent double resource bookings on the same time slot.
-- Pre-check: detect existing duplicates first.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_bookings_slot
  ON resource_bookings(resourceId, date, startTime, endTime);

-- Prevent duplicate iCal sources for the same property.
-- Pre-check: detect existing duplicates first.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ical_sources_property_platform
  ON ical_sources(propertyId, platformKey);
```

### Column removal

```sql
-- The single FK that nobody really uses; replaced by `propertyIds` JSON null/[]= global.
-- Wrapped in try/catch so re-runs don't crash.
ALTER TABLE resources DROP COLUMN propertyId;
```

**Runtime caveat discovered during implementation:** SQLite refuses to drop a column that is itself part of a `FOREIGN KEY` definition (the original `CREATE TABLE resources` declares `FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL`). `PRAGMA foreign_keys = OFF` does not help.

A full table rebuild (recreate without the column + copy rows + drop + rename) would work, but the gain is purely cosmetic — the application code no longer reads or writes the column. The hygiene pass therefore **logs an info-level message and leaves the column in place** on existing databases. Fresh installs or test schemas without the FK definition (like the unit tests) do drop the column cleanly. This is documented in CHANGELOG.md and verified by a dedicated test (`when propertyId is FK-defined (real schema), drop is refused but handled gracefully`).

### Migration safety net (executed once at startup)

Before each `CREATE UNIQUE INDEX`, run a count query of duplicates. If > 0, **skip the index creation** and log a clear French warning so the user can clean up the data manually:

```js
// Pseudo-code
const dupSlot = db.prepare(`
  SELECT resourceId, date, startTime, endTime, COUNT(*) c
  FROM resource_bookings
  GROUP BY resourceId, date, startTime, endTime
  HAVING c > 1
`).get();
if (dupSlot) {
  console.warn('[Hygiene] Doublons détectés dans resource_bookings — index unique non créé. Nettoyer manuellement puis redémarrer.');
} else {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_bookings_slot ...');
}
```

Same pattern for the iCal sources unique index.

For the `propertyId` column drop, wrap in try/catch — if already dropped, log info and continue.

**Data impact:**
- All existing rows preserved.
- Indexes are additive (no data change).
- Unique indexes only created if no duplicates exist (otherwise warning, no breakage).
- `resources.propertyId` column removed; the only code path that read it (line 168) is updated.

## 6. UI / UX

**No UI change.** This spec does not touch the client.

## 7. Test plan

### Server unit tests

- [ ] `tests/db-hygiene.unit.test.js` — booting a fresh `:memory:` DB with the full schema:
  - Asserts the presence of every index by name (`PRAGMA index_list(<table>)`).
  - Asserts the unique index `uniq_resource_bookings_slot` rejects a duplicate `INSERT`.
  - Asserts the unique index `uniq_ical_sources_property_platform` rejects a duplicate `INSERT`.
  - Asserts `resources` no longer has a `propertyId` column (`PRAGMA table_info(resources)`).
  - Asserts `idx_reservations_ical_source` is present and usable by an `EXPLAIN QUERY PLAN SELECT ... WHERE sourceIcalSourceId=? AND sourceIcalEventUid=?`.
  - Asserts `idx_ical_import_events_reservationId` is present.
- [ ] `tests/db-hygiene.unit.test.js` — duplicate-detection path:
  - Insert a duplicate resource_booking row, then bootstrap — the unique index is **not** created, a warning is logged (capture `console.warn`).

### Manual checks (no UI)

- [ ] Boot the app on the existing dev DB. No crash. Console shows the hygiene block executed (success or warning logs).
- [ ] Run a representative query and verify it uses an index: `db.prepare('EXPLAIN QUERY PLAN SELECT * FROM reservations WHERE propertyId = 1').all()` should mention `SEARCH ... USING INDEX idx_reservations_propertyId`.
- [ ] Regression: existing 127 server tests pass.
- [ ] Regression: manual smoke test — open the app, create a reservation, view finance, view the resource planning. Nothing breaks visually or functionally.

## 8. Out of scope

- **Dead column removal** (`checkInReady`, `cautionReceived`, etc.) — needs per-column grep + investigation; the audit suggested they were dead but real usage in route handlers / audit snapshots was found. Deferred to dedicated cleanup or to the per-feature retro-specs that own those columns.
- **iCal source columns on `reservations`** (`sourceType`, `sourcePlatformKey`, `sourceIcalSourceId`, `sourceIcalEventUid`, `icalSyncLocked`, `blocksPreviousNight`, `blocksNextNight`) and `ical_import_events` fingerprint columns (`eventHash`, `startDate`, `endDate`, `summaryNormalized`) — **explicitly NOT dead**, see §1.1. Any future spec proposing to drop these must first prove the anti-overbooking contract is preserved.
- **CHECK constraints on enums** (`platform`, `status`, `priceType`) — would require recreating each table in SQLite. High risk for marginal value at this stage; deferred to the feature retro-specs that own each enum.
- **Consolidation of the 103 inline `ALTER TABLE` migrations** into a single `CREATE TABLE` per table — high churn, requires moving every migration safely; deferred and probably done incrementally when each table is touched by its feature spec.
- **Fusion of `devis_*` and `reservation_*` sibling tables** — done in the Bloc 4 Devis spec (per the agreed strategy).
- **Normalization of `clients.phoneNumbers` JSON → `client_phones` pivot table** — done in the Bloc 1 Clients spec.
- **Dénormalisation of `unitPrice` / `totalPrice` / `address`** — done in the relevant pricing / clients specs.
- **Soft-delete or audit trail before CASCADE deletions** — separate concern; tracked but not in this spec.

## 9. Open questions

- Q: For the duplicate-warning logs, do we want them only in development, or always (including production)?
  - **A: Always.** A user running prod needs to know about the data inconsistency so they can fix it.
- Q: Should the `propertyId` column drop be wrapped in a transaction with rollback on failure?
  - **A:** SQLite `ALTER TABLE DROP COLUMN` is non-transactional from the app's perspective (it triggers an internal table rebuild). `try/catch` is sufficient — if the column is already gone, we catch the "no such column" error and continue.
- Q: Should we add `EXPLAIN QUERY PLAN` assertions in tests to confirm indexes are actually used by the query planner?
  - **A:** No — overkill for this spec. Index presence + the manual smoke check are enough. We can add `EXPLAIN` assertions later if a perf regression appears.

---

## 10. Tech debt addressed

- Foreign-keyed columns are now indexed (~31 indexes added, eliminates table scans).
- Double-booking risk on `resource_bookings` is blocked at the DB level.
- Duplicate iCal source risk is blocked at the DB level.
- **iCal sync primary lookup now indexed** in both directions (`reservations(sourceIcalSourceId, sourceIcalEventUid)` + `ical_import_events(reservationId)`) — supports the anti-overbooking contract at scale.
- The iCal anti-overbooking contract is now formally documented (§1.1) — future specs cannot regress it by accident.
- `resources.propertyId` / `propertyIds` ambiguity eliminated — single source of truth.

## 11. Deferred (separate future specs / per-feature retro-specs)

- Dead column removal (per-feature investigation needed).
- CHECK constraints on enums (per-feature, when the enum is owned).
- Migration consolidation (per-feature, when the table is rewritten).
- Devis/réservation siblings fusion (Bloc 4 Devis spec).
- Phone numbers / propertyIds JSON normalization (Bloc 1 Clients & Resources specs).
- Price denormalization (Bloc 2 Pricing engine spec).
- Soft-delete + audit trail before CASCADE (separate concern).
