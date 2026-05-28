# Devis ↔ Reservation table fusion

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/devis-reservation-fusion` _(Claude-managed)_ |
| **Created** | 2026-05-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 4 remainder (carried from Bloc 0). See `specs/ROADMAP.md`. |

> ⚠️ **Highest-risk change in the codebase.** It carries a **data migration** and touches occupancy,
> finance, calendar, and iCal. **No migration runs until this spec's strategy is approved.** Implementation
> is phased (below); each phase is its own reviewed PR.

---

## 1. Context

`devis_*` and `reservation_*` are **near-identical sibling table families**. A devis is essentially a
draft reservation; "accept" already **copies the whole graph** (`devisModel.convertToReservation` /
`convertFromReservation`) — duplicating persistence, pricing wiring, audit, and PDF/quote shaping across
two parallel stacks.

**Schema diff (today):**

| | `reservations` | `devis` |
|---|---|---|
| Shared | propertyId, clientId, start/endDate, adults/children/teens/babies, beds, check-in/out, platform, totalPrice, touristTax*, discountPercent, customPrice, finalPrice, deposit*/balance*, **cautionAmount**, notes, created/updatedAt | same |
| Only here | depositPaid, balancePaid, cautionReceived(+Date), cautionReturned(+Date), checkInReady, checkInDone, checkOutDone, sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked, extraGuestSurchargeOffered, blocksPreviousNight, blocksNextNight | **devisNumber (UNIQUE)**, **status**, **validUntil**, **convertedReservationId** |
| Children | `reservation_options` / `_custom_options` / `_resources` / `_nights` / `_history` | `devis_options` / `_custom_options` / `_resources` / `_nights` / `_history` (structurally identical, `devisId` vs `reservationId`) |

**Live data:** 37 reservations, 6 devis (small → easy to back up + verify row-for-row).

**Why fuse:** one storage + one persistence/audit/quote path; "convert" becomes a **status flip** (no graph
copy); the devis route already shares `calculateReservationQuote` + `devisPdf`.

## 2. Goal

A devis and a reservation are the **same row** in one unified table, distinguished by a `kind`
discriminator. The devis domain keeps its API/UX (numbering, status, validity, PDF, convert) but is backed
by the reservation tables. **No user-visible behaviour change**; existing data preserved exactly.

## 3. Proposed design (recommended) — unify into `reservations`

Fold devis **into the reservation tables** (the mature, central stack) rather than create a third table —
the 37 reservations stay put; only the 6 devis migrate in.

1. **`reservations` gains:** `kind TEXT NOT NULL DEFAULT 'reservation'` (`'reservation'|'devis'`),
   `devisNumber TEXT` (UNIQUE when not null), `devisStatus TEXT` (the devis `status`: draft/sent/accepted/
   converted/refused), `validUntil TEXT`, `convertedFromDevisId`/`convertedReservationId` link. A devis row
   has `kind='devis'`, null payment-paid/source/ical fields; a reservation has `kind='reservation'`, null
   devis fields.
2. **Children unified:** devis_options/custom/resources/nights/history rows migrate into the matching
   `reservation_*` tables (keyed by the new reservation id). `devis_*` tables are dropped **after** a
   verified migration.
3. **`kind`-awareness is mandatory and the central risk.** Every query that concerns **occupancy,
   availability, the calendar block/overlay, finance, iCal sync, and the reservations list** must filter
   `kind='reservation'` so a devis **never blocks a date or counts as revenue**. Devis stay a faded
   calendar overlay (now `kind='devis'`), exactly as today. §4.4 enumerates every site.
4. **Convert = status flip.** `devis→reservation` sets `kind='reservation'` + clears devis-only fields +
   keeps the graph in place (no copy); `reservation→devis` the reverse. History preserved.
5. **Devis domain unchanged externally.** `devisModel`/`devisController`/`routes/devis.js`/`devisPdf` keep
   their contracts but read/write `reservations WHERE kind='devis'` (+ the `*_history`/children). Devis
   numbering (`generateDevisNumber`) unchanged.

**Alternative (Open Question):** a brand-new `bookings` table with both families migrating in — cleaner
discriminator, but migrates **all 43 rows** and rewrites **both** domains (larger blast radius). Trade-off
in §9.

## 4. Architecture

### 4.1 Migration (the dangerous part — idempotent, backed-up, reversible)

- Pre-flight: `VACUUM INTO` (or file copy) a timestamped DB backup before any DDL.
- Add the new `reservations` columns (idempotent `ADD COLUMN IF NOT EXISTS`-style).
- For each `devis` row: insert a `reservations` row (`kind='devis'`, mapped fields, preserve devisNumber/
  status/validUntil/convertedReservationId), remember `devisId → newReservationId`; copy its
  options/custom/resources/nights/history into `reservation_*` with the new id; rewrite
  `convertedReservationId` cross-links.
- Guard: run only when `devis` tables exist **and** a `migratedDevisAt` marker is unset; verify counts
  (devis rows in == new `kind='devis'` rows; children counts match) before dropping `devis_*`.
- **Reversibility:** the backup is the rollback. The migration block is documented in `CHANGELOG.md`
  under `Migration` with the exact mapping + how to restore.

### 4.2 Server

| Layer | File | Responsibility |
|---|---|---|
| `database.js` | new columns + the guarded one-time devis→reservations data migration + drop `devis_*`. |
| `models/devisModel.js` | repoint all SQL to `reservations`/`reservation_*` with `kind='devis'`; convert = status flip; numbering kept. |
| `models/reservationsModel.js` + `occupancyValidator` | add `kind='reservation'` to every availability/occupancy/list query (§4.4). |
| `models/financeModel.js` | `kind='reservation'` on summary/projection/operational/tourist-tax. |
| `models/propertyIcalModel.js` | iCal sync only ever touches `kind='reservation'` rows. |
| `controllers/*`, `routes/devis.js`, `utils/devisPdf.js` | unchanged contracts; consume the repointed model. |

### 4.3 Client

No contract change expected (devis + reservation APIs keep their shapes). CalendarPage devis overlay,
DevisPage, ReservationPage `?mode=devis` unchanged. Verify only.

### 4.4 `kind='reservation'` filter audit (mandatory checklist)

Reservation reads that must exclude devis: list, `getByIdWithDetails` (when used for reservation context),
occupancy/`getOccupiedReservations`, availability, calendar occupied-dates, blocked-night, finance
summary/projection/operational, tourist-tax, iCal sync mapping + stale removal, dashboard arrivals/
departures. Each gets an explicit `kind='reservation'` predicate + a test.

## 5. Data model

See §4.1. Schema change + **one-time data migration**. Data impact: **high if wrong** — mitigated by
backup + count verification + reversibility; the live set is tiny (6 devis).

## 6. UI / UX

No visible change. Devis list/editor/PDF/convert and the reservation flows behave identically.

## 7. Test plan

- [x] **Migration test** `devis-fusion-migration.unit.test.js` (3): seed legacy `devis_*` + `reservation_*`,
  run the migration, assert every devis + children + history landed as `kind='devis'` rows with preserved
  devisNumber/status→devisStatus/validUntil, converted-link kept, existing reservation untouched,
  `devis_*` dropped, idempotent re-run.
- [x] **kind-isolation test** (finance): a `kind='devis'` row never appears in revenue/overdue/pending/
  upcoming. The repointed reservations/resources/closures/finance tests seed `kind='reservation'` and pass.
- [x] **Devis domain tests** repointed to the fused store (`devis-model`, `devis-model-create`): findById/
  enrich, updateStatus, remove, create/update persistence + audit, both convert flows — all green.
- [x] Full server suite green (**340**).
- [x] In-browser (migrated live DB, 0 console errors): devis list shows the 6 migrated devis
  (`status`/`devisNumber` intact), devis detail + **PDF 200**; the 37 reservations + finance revenue carry
  **no devis** (`devisNumber=null` everywhere); convert/create covered by the unit suite.

**Live migration result:** backup written, 6 devis → `kind='devis'`, 37 reservations `kind='reservation'`,
`devis_*` dropped.

## 8. Out of scope

- Any behaviour/UX change to devis or reservations (pure storage convergence).
- Per-extra payment tracking; pricing changes.

## 9. Decisions (resolved 2026-05-28)

- **Q1 — Design → fold devis into `reservations`** (`kind` discriminator). Only the 6 devis migrate in.
- **Q2 — Phasing → one PR** (schema + migration + repoint + kind-filter audit + drop `devis_*` + tests).
- **Q3 — `devisStatus`** dedicated column (null for reservations); no general reservation `status`.
- **Convert semantics (preserved):** `devis→reservation` still **creates** a `kind='reservation'` row from
  the devis graph and marks the devis `kind='devis'` / `devisStatus='converted'` with the link — so a
  converted devis stays visible in the devis list exactly as today (the win is one storage/persistence/
  audit path, not skipping the copy). New conversions and the existing 2-row converted records stay
  consistent.
