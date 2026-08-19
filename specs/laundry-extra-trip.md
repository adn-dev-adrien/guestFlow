# Extra laundry trip — early pick-up on a free date

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/laundry-extra-trip` |
| **Created** | 2026-08-19 |
| **Implemented** | 2026-08-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md), [linen-inventory-shortage-tracking.md](linen-inventory-shortage-tracking.md), [skip-laundry-trip.md](skip-laundry-trip.md), [manual-laundry-additions.md](manual-laundry-additions.md) |

---

## 1. Context

The laundry runs on a **weekly cadence**: every occurrence of `app_settings.laundryWeekday` is a
projected trip (no row in the DB), where the operator drops the dirty linen accumulated since the
previous trip and picks up the batch dropped the week before. Two overlays already exist on top of
that cadence — a trip can be marked **not made** (`laundry_trip_skips`, its batches defer to the next
trip) and a trip can carry **manual linen** in or out (`laundry_trip_manual_additions`).

What the model cannot say: *« I went to the laundry on a day that is not the laundry day »*. When the
clean stock runs short, Adrien asks the laundry to have the linen ready earlier, drives there on a
free date, brings the dirty linen he has, and takes back **everything that is in progress** — or,
sometimes, only **part of it**. Today neither the Planning summary
([planningController.laundrySummary](../server/src/controllers/planningController.js)) nor the stock
engine ([utils/linenInventory.js](../server/src/utils/linenInventory.js)) can represent that trip: the
early pick-up is invisible, the projected clean stock stays short for a week, and the next weekly
card still promises to bring linen that already went and to fetch linen that already came back.

## 2. Goal

From the Planning, an **admin** declares an **extra laundry trip** on any date (past or future): the
dirty linen goes that day, and the linen at the laundry comes back — all of it, or the per-type
quantities he actually took. The laundry card appears on that date, the surrounding weekly cards
recompute (drop-off since the extra trip, pick-up of what was dropped there plus any remainder), and
the stock projection + shortage alert follow.

## 3. Functional rules

### 3.1 The extra trip

1. **A global dated record.** An extra trip is identified by its ISO date (`YYYY-MM-DD`), global
   across properties (one human, one trip per day — same scope as skips and manual lines). One extra
   trip per date at most.
2. **Any date except a regular laundry day.** Past dates are allowed (the operator declares « I went
   yesterday » and the projected stock re-aligns, exactly like a past skip). A date whose weekday
   equals `laundryWeekday` is refused (`400 EXTRA_TRIP_ON_LAUNDRY_DAY`) — that day is already a trip;
   un-skip it instead. If the weekday setting later changes so that a stored extra trip lands on the
   new laundry weekday, that record becomes **inert** (ignored by the summary and by the engine; the
   regular rules apply that day) — mirrors the skip spec's « skip on a non-laundry day is inert ».
3. **Drop-off = the whole dirty pile.** On an extra trip the operator always brings all the dirty
   linen accumulated since the previous trip (« on apporte le linge sale qu'on a »). No partial
   drop-off.
4. **Pick-up = all, or a declared part.** The record holds `pickUpAll` (default **true**) and, when
   false, seven non-negative integers — the quantities actually taken back per linen type
   (`singleBeds`, `doubleBeds`, `babyBeds`, `largeTowels`, `mediumTowels`, `smallTowels`,
   `bathMats`). What is not taken **stays at the laundry** and comes back on the next trip (rule 8).
5. **Declared quantities are capped at what is at the laundry.** The summary and the engine take
   `min(atLaundry[type], declared[type])` per type at compute time — one can never fetch more than
   what is there, even if reservations changed after the trip was recorded.
6. **Editable, deletable.** The pick-up mode and quantities can be edited any time; the trip can be
   deleted (idempotent). Deleting an extra trip also deletes the manual-additions row stored on that
   date, if any (rule 12), so no manual line is left on a date that is no longer a trip.

### 3.2 Trip sequence, drop-off and pick-up (Planning summary)

7. **Trip sequence.** The set of trips **S** = every non-skipped regular laundry day ∪ every active
   extra trip, sorted. `prevTrip(T)` = the latest element of S strictly before `T`. When nothing is
   found within the 28-day lookback, fall back to `T − 7` (today's degenerate rule).
   **Drop-off(T)** = reservation linen with `endDate ∈ (prevTrip(T), T]` + the signed manual lines of
   the trip dates in that window, floored at 0 per type — the existing `buildBlock` formula; only the
   left bound changes. Consequence: the weekly trip that follows an extra trip only carries the linen
   dirtied **since** the extra trip.
8. **Pick-up is a pool, not a fixed 7-day batch (decision 2026-08-19).** After a non-skipped regular
   trip **R** the pool at the laundry is exactly `Drop-off(R)` (a regular trip always takes everything
   back). Walking S forward from R: for each extra trip **E**, `pick(E) = pickUpAll ? pool :
   min(pool, declared)` per type, then `pool ← pool − pick(E) + Drop-off(E)`. For a trip **T**:
   - **T regular** → `Pick-up(T) = pool before T` — *everything at the laundry*, i.e. the linen dropped
     at an extra trip a few days earlier **plus** any remainder a partial pick-up left behind.
   - **T extra** → `Pick-up(T) = pick(T)`; the card also states `leftAtLaundry = pool − pick(T)`.
   With no extra trip the pool before a regular trip is exactly the previous trip's drop-off — the
   current contract, byte for byte.
9. **Skips unchanged.** A skipped regular day is not in S: it emits zeros as today, and the next
   trip's window widens across it. An extra trip cannot be skipped — delete it.
10. **Summary payload.** `GET /api/planning/laundry` now lists the extra trips of the range next to
    the regular days, chronologically. Every entry gains `kind: 'regular' | 'extra'`; extra entries
    add `pickUpAll: boolean` and `leftAtLaundry: { seven types }`. `dropOff.incomplete` (stays that
    declare linen without a quantity) is computed for extra trips with the same window.

### 3.3 Stock engine (`simulateInventory`)

11. **Trip days.** A day is a trip day when it is a non-skipped regular laundry day OR an active extra
    trip. On a trip day, in this order: pick-up (before check-ins — rule 6 of the inventory spec),
    check-ins, manual line, drop-off of the whole dirty pile → `atLaundry`.
12. **Pick-up rule.** The `atLaundry` bucket is a per-type pool. A regular trip moves the **whole**
    pool → `clean`. An extra trip moves the whole pool when `pickUpAll`, else `min(pool, declared)`
    per type; the rest stays in `atLaundry`. (Without extra trips this is equivalent to today's
    « batches dropped ≥ 7 days ago » rule: batches only enter the pool on regular days, and the next
    regular day is ≥ 7 days later — the per-date batch ledger `dropsByLaundryDay` is retired.)
    Manual lines on an extra date behave as on any trip (positive → washed on that trip, negative →
    dirty → clean, capped at the dirty pile).
13. **Initial state with past extra trips.** Let `R0` be the last non-skipped regular trip ≤ `today`
    (existing lookup). The initial `atLaundry` = `Drop-off(R0)` (existing 7-day-guarded seed, whose
    window now starts at the last extra trip between `R0 − 7` and `R0` if any) then replays each extra
    trip `E ∈ (R0, today)` in order: `pool ← pool − pick(E) + Drop-off(E)` (reservation contracts,
    windows `(prevTrip(E), E]`). The initial `dirty` = contracts with `endDate ∈ (lastTrip, today]`
    where `lastTrip = max(R0, last extra < today)`. An extra trip **on** `today` is executed by the
    day-`today` iteration of the loop, like any trip day. With no extra trip the init is unchanged.
    Known approximation (pinned by a test): when the seed guard does not fire (last regular trip more
    than a week back — e.g. today is a skipped laundry day), the pool starts at 0, so a partial
    remainder from before that trip is not tracked — the same class of approximation as the guard.
14. **Reservation lookback.** `linenInventoryModel.simulate` fetches reservations with
    `endDate ≥ today − 35` (was `− 7`) so the replay of rule 13 and the widened windows have their
    rows. Conservation invariant `clean + inCirculation + dirty + atLaundry = stock` holds on every
    day (asserted by tests).
15. **Inventory line + shortage alert.** `GET /api/planning/linen-inventory` emits `byLaundryDay` for
    extra dates too (so the extra card shows « Disponible après ce dépôt »). The Dashboard shortage
    alert needs no change: it reads the same simulation.

### 3.4 Roles

16. **Admin only for writes.** `PUT` / `DELETE /api/laundry/extra-trips/*` are NOT added to the
    reception allowlist (`enforceRoleAccess.RECEPTION_MATCHERS`) — the existing `GET /laundry/*`
    matcher lets the reception role read the trips so its Planning renders the card. Client side, the
    « voyage exceptionnel » action-bar button and the card's edit / delete buttons are hidden in
    `receptionMode`; the manual-line « + » keeps today's behaviour (reception may add linen).

### 3.5 UI

17. **Entry point** — Planning `PageActionBar`, `actionsBefore`: one icon button (laundry icon),
    tooltip *« Ajouter un voyage blanchisserie exceptionnel »*, admin only. Opens the dialog of
    rule 18 in create mode.
18. **Dialog « Voyage blanchisserie exceptionnel »** — one date field (default: today) and, once a
    valid non-laundry date is chosen, a server preview (`GET …/preview?date=`) rendered as two lines:
    *« À apporter ce jour-là : … »* (the dirty pile) and *« À la blanchisserie ce jour-là : … »* (the
    pool). Then a choice: **« Tout récupérer »** (default) or **« Récupérer une partie »**, which
    reveals one `QuantityField` per linen type present in the pool, prefilled with the pool value and
    capped by it (`max`). A laundry-day date shows the inline error *« Ce jour est déjà un jour de
    blanchisserie »* and disables Save. Save → `PUT`; the Planning refetches summary + inventory +
    trips. Edit mode: same dialog, date fixed, prefilled with the stored mode / quantities.
19. **The extra card** — same `LaundryDayCard`, header title *« Voyage blanchisserie exceptionnel »*
    with a small « exceptionnel » chip; header actions (admin): edit (pencil) → dialog in edit mode,
    delete (trash) → `ConfirmDialog` *« Supprimer ce voyage exceptionnel ? »*; the manual-line « + »
    as today; **no** skip toggle. Body: « À apporter » / « À récupérer » as today; when `pickUpAll`
    is false, an italic caption *« Récupération partielle — reste à la blanchisserie : … »* lists
    `leftAtLaundry` (only non-zero types; *« … — plus rien ne reste à la blanchisserie »* when the
    remainder is empty). On `xs` the title shortens to *« Voyage exceptionnel »* and the chip is hidden
    (the header also holds the three icon buttons). The « Disponible après ce dépôt » block renders as
    on a regular card. **Always rendered** when the trip exists (hide-when-empty bypassed, like a skipped
    card) so the operator sees and can undo his own decision; the date joins the Planning day-set.
20. **Optimistic + confirmed** — like skips: after PUT / DELETE succeed, the page refetches
    `getLaundryPlanningSummary({ from })`, `getLinenInventory()` and `getLaundryExtraTrips()`; on
    failure a snackbar *« Impossible d'enregistrer le voyage exceptionnel. »* / *« … de supprimer … »*.

**Edge cases:**
- Extra trip with nothing dirty and nothing at the laundry → the card renders with « — » on both
  sides (rule 19), the trip is a no-op for the engine.
- Two extra trips in the same week (E1 then E2) → E2's window is `(E1, E2]`, its pool is what E1
  left plus E1's drop-off; the next regular trip takes everything remaining.
- Extra trip declared **partial** with quantities larger than the pool → capped (rule 5); the caption
  shows the real remainder (possibly nothing).
- Extra trip in the future (planned early pick-up) → same rules; the surrounding weekly cards already
  show the recomputed windows so the operator sees the effect before driving.
- Extra trip between a skipped regular day and the next regular day → the extra takes the deferred
  dirty pile (its window reaches back across the skip) and, if `pickUpAll`, the deferred pool; the
  next regular trip only fetches what the extra dropped.
- Weekday setting changed so an extra falls on the laundry day → inert (rule 2); it stays stored so a
  revert restores it.
- Reception user → sees the card and the captions, no create / edit / delete controls; a direct
  `PUT`/`DELETE` returns `403 FORBIDDEN_ROLE`.

---

## 4. Architecture

> **Fat backend, thin frontend.** The trip sequence, the pool ledger, the caps and the whole stock
> simulation live on the server. The client renders the payload, opens dialogs and calls the API.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent `CREATE TABLE IF NOT EXISTS laundry_extra_trips` (§5). |
| `models/` | `models/laundryExtraTripsModel.js` | C | Sole DB access: `listAll() → [{ date, pickUpAll, pickUp: {7 types} }]`, `get(date)`, `set(date, { pickUpAll, pickUp })` (upsert; rounds, clamps ≥ 0; zeroes the counts when `pickUpAll`), `remove(date)` (idempotent, returns boolean), `count()`. Factory `create(db)` + default, mirroring `laundryTripSkipsModel`. |
| `models/` | `models/laundryManualAdditionsModel.js` | T | Adds `remove(date)` (used by the cascade of rule 6). |
| `utils/` | `utils/laundryWindow.js` | T | Adds + exports `previousOrSameLaundryDay(iso, weekday)`, `previousNonSkippedRegularBefore(iso, weekday, skipped, maxLookbackDays = 28)` (the regular anchor strictly before any date, same 4-candidate / `null` semantics as `previousNonSkippedLaundryDay` so a regular date gives the same answer) and `activeExtraDates(dates, weekday)` (drops the inert ones, sorted). Pure, DST-safe. The engine keeps its own private init helper (different degenerate semantics, pinned by tests). |
| `utils/` | `utils/laundryTripLedger.js` | C | Pure pool ledger (§3.2 rules 7-8): `createTripLedger({ weekday, skippedDates, extraTrips, buildBlock, incompleteFor })` → `{ entryFor(date), previewFor(date), prevTrip, poolBefore, extraDates }`; `entryFor` returns `{ date, kind, dropOff (+incomplete), pickUp }` (+ `pickUpAll`, `leftAtLaundry` for an extra) or `null` on a non-trip date; skipped regular days emit zeros without any model call. `makeBlockBuilders({ laundryModel, laundryManualAdditionsModel })` → `{ buildBlock, incompleteFor }` (moved from the controller) so the summary and the preview share one definition of a window. No memoization on purpose (the call order per trip is pinned by the controller tests). |
| `utils/` | `utils/linenInventory.js` | T | `simulateInventory` accepts `extraTripsByDate: Map<date, { pickUpAll, pickUp }>`; trip-day detection, pool pick-up (whole / capped, skipped on day `from` when `from` is itself the seeded regular trip), manual line on `isLaundryWeekday || extra`, init-state replay (rules 11-13); each day entry gains `isTripDay`. `dropsByLaundryDay` retired in favour of the per-type pool. |
| `models/` | `models/linenInventoryModel.js` | T | Loads the extra trips (guard `HAS_EXTRA_TRIPS_TABLE` wraps the model construction, like the bath-mat guard, so minimal test schemas degrade to none), maps them to engine keys, widens the reservation lookback to 35 days (rule 14). |
| `controllers/` | `controllers/planningController.js` | T | Injects `laundryExtraTripsModel`; `laundrySummary` lists the wanted dates (regular occurrences ∪ active extra trips in range) and delegates to `createTripLedger(...).entryFor` (regular + extra entries, `kind`, extra fields); `linenInventory` emits `byLaundryDay` for `isLaundryDay || day.isTripDay`. |
| `controllers/` | `controllers/laundryExtraTripsController.js` | C | Factory `create({ extraTripsModel, manualAdditionsModel, settingsModel, laundryModel, skipsModel })`: `list`, `preview` (ledger `previewFor` for one date: `dropOff` + `atLaundry`), `set` (validates date + refuses laundry-day dates + `INVALID_PICKUP`), `remove` (then the manual line of that date). Thin; mirrors the skips controller. |
| `routes/` | `routes/laundry.js` | T | `GET /extra-trips`, `GET /extra-trips/preview` (declared before the `/:date` routes), `PUT /extra-trips/:date`, `DELETE /extra-trips/:date`. |
| `schema.sql` | `schema.sql` | T | The new table, alphabetical (source of truth — `specs/migrations-baseline.md` §5). |
| `middleware/` | `middleware/enforceRoleAccess.js` | — | No change: the reception allowlist does not include the new writes (GET already matched). The drift test gains the two forbidden cases. |
| `tests/` | see §7 | C/T | |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `api.js` | `api.js` | T | `getLaundryExtraTrips()`, `previewLaundryExtraTrip(date)`, `setLaundryExtraTrip(date, payload)`, `deleteLaundryExtraTrip(date)`. |
| `pages/` | `pages/PlanningPage.jsx` | T | Keeps the whole summary entry per date (`indexLaundryDays`) so `kind` / `pickUpAll` / `leftAtLaundry` reach the card; fetches the extra trips (dialog prefill) with the other laundry data; one `refetchLaundryState()` (summary from `startDate` + inventory + manual lines + extra trips) reused by the skip / manual / extra handlers; extra entries pass the day-set filter; action-bar item (admin); `LaundryExtraTripDialog` + `ConfirmDialog`; passes `onEditExtra` / `onDeleteExtra` only outside reception mode. |
| `components/` | `components/LaundryDayCard.jsx` | T | Extra variant: title (+ short `xs` title) + chip, pencil / trash header actions (when handlers provided), no skip toggle (`isSkipped` ignored), partial caption, always-rendered rule. Formatters moved to `utils/formatLinen.js`. |
| `components/` | `components/LaundryExtraTripDialog.jsx` | C | Feature dialog (create / edit): `DateField`, server preview (cancelled-flag guarded) with inline error from the server code, mode radio (partial disabled on an empty pool), `QuantityField` per type present at the laundry (capped, prefilled with the pool or the capped stored value), hidden types submitted as 0, `fullScreen` on `xs`. |
| `utils/` | `utils/formatLinen.js` | C | `formatSheets` / `formatTowels` / `formatLinenBlock` — the French one-line formatters of a per-type linen block, shared by the card and the dialog (extracted from the card). |
| `constants/` | — | — | (none — French strings co-located in the two components) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar` (`actionsBefore`), `DateField`, `QuantityField` (`max`), `ConfirmDialog`, MUI `Dialog` / `Radio` / `Chip` / `IconButton` / `Tooltip` | All pre-existing. |
| **Created (new generic)** | `utils/formatLinen.js` | Presentational formatters (pluralisation, zero omission) for the per-type linen block every laundry endpoint emits — a second consumer (the dialog) justified extracting them from the card. |
| **Specific (kept feature-local)** | `LaundryExtraTripDialog`, `LaundryDayCard` extension | Both carry the laundry domain (French copy, seven-type payload, pool semantics). |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/laundry/extra-trips` | — | `{ trips: [{ date, pickUpAll, pickUp: { singleBeds, doubleBeds, babyBeds, largeTowels, mediumTowels, smallTowels, bathMats } }] }` sorted ASC | Any Planning role. |
| GET | `/api/laundry/extra-trips/preview?date=YYYY-MM-DD` | — | `{ date, dropOff: {7 types}, atLaundry: {7 types} }` | What an extra trip on `date` would drop and what would be at the laundry before it (other extra trips considered, the record on `date` itself ignored). 400 `INVALID_DATE`; 400 `EXTRA_TRIP_ON_LAUNDRY_DAY`. Any Planning role. |
| PUT | `/api/laundry/extra-trips/:date` | `{ pickUpAll: boolean, pickUp?: {7 types} }` | `{ ok: true, trip: {…} }` | Upsert. 400 `INVALID_DATE`; 400 `EXTRA_TRIP_ON_LAUNDRY_DAY`; 400 `INVALID_PICKUP` when `pickUpAll` is false and `pickUp` is missing. Counts rounded, clamped ≥ 0. **Admin only** (403 for reception). |
| DELETE | `/api/laundry/extra-trips/:date` | — | `{ ok: true }` | Idempotent; also removes the manual-additions row of that date. **Admin only.** |
| GET | `/api/planning/laundry?from=…[&to=…]` | — | `laundryDays[]` entries gain `kind`; extra entries add `pickUpAll`, `leftAtLaundry` | Extra trips of the range are listed chronologically among the regular days. |
| GET | `/api/planning/linen-inventory` | — | `byLaundryDay` also keyed by extra dates | |

Error shape `{ error, code }` as the skips endpoints.

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS laundry_extra_trips (
  tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
  pickUpAll    INTEGER NOT NULL DEFAULT 1,
  singleBeds   INTEGER NOT NULL DEFAULT 0,
  doubleBeds   INTEGER NOT NULL DEFAULT 0,
  babyBeds     INTEGER NOT NULL DEFAULT 0,
  largeTowels  INTEGER NOT NULL DEFAULT 0,
  mediumTowels INTEGER NOT NULL DEFAULT 0,
  smallTowels  INTEGER NOT NULL DEFAULT 0,
  bathMats     INTEGER NOT NULL DEFAULT 0,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Idempotent `CREATE TABLE IF NOT EXISTS` in `database.js`. Purely additive — no existing row or table is
touched, no backfill. **Data impact:** none.

## 6. UI / UX

### `/planning` — action bar
`<PageActionBar title="Planning" … actionsBefore={[{ icon: <LocalLaundryServiceIcon/>, tooltip:
'Ajouter un voyage blanchisserie exceptionnel', onClick, color: 'info' }]} />` — the item is only
present for admins.

### Dialog « Voyage blanchisserie exceptionnel »
```
┌ 🧺 Voyage blanchisserie exceptionnel ──────────────────┐
│ Date  [ 2026-08-21 ▾ ]                                  │
│ À apporter ce jour-là : Draps : 4 doubles · 2 simples   │
│                          Serviettes : 8 grandes · 8 pet.│
│ À la blanchisserie ce jour-là : Draps : 6 doubles …     │
│ ○ Tout récupérer   ● Récupérer une partie               │
│   Draps      Double  [−] 6 [+]   Simple [−] 3 [+] …     │
│   Serviettes Grande  [−] 9 [+]   Petite [−] 9 [+] …     │
│                               [Annuler] [Enregistrer]   │
└─────────────────────────────────────────────────────────┘
```
- Header band in the laundry cyan (same as the manual dialog). Create mode: date editable, defaults to
  today. Edit mode: date read-only.
- Preview lines use the card's formatters (« — » when empty). While the preview loads: « Calcul… ».
- Laundry-day date → inline `error.main` text « Ce jour est déjà un jour de blanchisserie », Save
  disabled. Server error → snackbar.
- Partial mode: one `QuantityField` per type whose pool value > 0 (types absent from the pool are not
  shown), `min 0`, `max = pool[type]`, prefilled with the pool value.
- **Responsive:** `fullScreen` on `xs`; the quantity rows stack (label above field) on `xs`, two
  columns on `sm+`; touch targets ≥ 44 px.

### The extra card (Planning)
```
┌───────────────────────────────────────────────────────────┐
│ 🧺 Voyage blanchisserie exceptionnel  [exceptionnel]  ✎ 🗑 + │
│ À APPORTER                    │ À RÉCUPÉRER               │
│ Draps : 4 doubles · 2 simples │ Draps : 6 doubles         │
│ Serviettes : 8 grandes        │ Serviettes : 9 grandes    │
│ Récupération partielle — reste à la blanchisserie : 3 simples │
│ ───────────────────────────────────────────────────────── │
│ DISPONIBLE APRÈS CE DÉPÔT  Draps : 5 doubles · 1 simple   │
└───────────────────────────────────────────────────────────┘
```
Same palette as the weekly card; the chip is `size="small"` outlined in the accent colour. Header
actions hidden in reception mode (except the manual « + »). Delete → `ConfirmDialog` « Supprimer ce
voyage exceptionnel ? » / « Le linge de cette date retournera dans le calcul du voyage suivant. ».
**Responsive:** identical to the weekly card (blocks stack on `xs`).

### PageActionBar
Only the Planning bar changes (one `actionsBefore` item). No new page.

## 7. Test plan

### Server unit tests
- [x] `tests/laundry-extra-trips-model.unit.test.js` (8) — list empty; set/upsert; `pickUpAll` zeroes
      the counts; negatives clamped, rounding; sorted; remove idempotent; malformed dates throw.
- [x] `tests/laundry-extra-trips-endpoint.unit.test.js` (10) — GET shape; PUT all / partial; 400 bad
      date; 400 on a laundry-day date; 400 partial without counts; DELETE idempotent + cascades the
      manual line; preview shape + 400s.
- [x] `tests/laundry-trip-ledger.unit.test.js` (10) — no extras ≡ today's windows + call order; skipped
      day queries nothing; extra between two regulars (E takes all → next regular fetches only E's
      drop); partial pick-up (capped, `leftAtLaundry`, remainder returns next regular); two extras in a
      week; extra after a skipped regular (widened window + deferred pool); inert extra on a laundry
      day; non-trip date → null; preview ignores the date's own record; `incompleteFor` once per trip.
- [x] `tests/laundry-window.unit.test.js` (+4) — `previousOrSameLaundryDay`,
      `previousNonSkippedRegularBefore` (regular ≡ `previousNonSkippedLaundryDay`; free date),
      `activeExtraDates`.
- [x] `tests/planning-laundry-controller.unit.test.js` (+3, fixtures inject the extra-trips stub) — extra
      entries in `laundryDays` with `kind`, `pickUpAll`, `leftAtLaundry`; an out-of-range extra still
      shapes the windows; an inert extra is listed as the regular day; the full-entry `deepEqual` now
      carries `kind: 'regular'`; every other assertion unchanged.
- [x] `tests/linen-inventory-extra-trip.unit.test.js` (10) — baseline; extra day picks the whole pool
      before check-ins (+ a same-day arrival fits thanks to it); partial pick-up leaves the remainder in
      `atLaundry` and the next regular trip returns it; conservation invariant every day; inert on a
      laundry day; no extras ≡ baseline; init replay with a past extra trip (all / partial); extra on
      `today`; the seed-guard quirk (documented). Existing `linen-inventory*` suites pass unchanged.
- [x] `tests/linen-inventory-model-skip-propagation.unit.test.js` (+1, DDL gains the table) — a
      `laundry_extra_trips` row propagates through `linenInventoryModel.simulate()`.
- [x] `tests/reception-role-access.unit.test.js` — `GET /laundry/extra-trips` + `/preview` allowed;
      `PUT` / `DELETE /laundry/extra-trips/2026-08-21` forbidden.
- [x] `tests/laundry-end-to-end.regression.test.js` (+1, fixture injects the extra-trips stub) — real
      DB: a partial extra trip on Thursday between two Tuesdays → Thursday card (drop since Tuesday,
      capped pick-up, remainder), next Tuesday card (drop since Thursday, pick-up = remainder +
      Thursday's batch); the engine fed the same rows agrees day by day.

Server suite: 3004 → **3051** tests.

### Client tests (vitest)
- [x] `LaundryDayCard.extra.test.jsx` (7) — extra title + chip; pencil / trash call the handlers; hidden
      without handlers (reception); no skip toggle; partial caption (+ empty remainder); rendered when
      both sides are empty; stale skip flag ignored; regular card untouched.
- [x] `LaundryExtraTripDialog.test.jsx` (6, `api` mocked) — preview lines; « Tout récupérer » saves
      `pickUpAll: true`; partial reveals capped fields prefilled with the pool and saves the counts;
      edit mode (date fixed, stored counts capped); laundry-day error disables Save; empty pool disables
      partial + Annuler.
- There is no PlanningPage vitest harness: the admin-only gating of the action-bar item and of the
  card handlers is verified manually (below) and by the « no handlers → no buttons » card test.

Client suite: 974 → **987** tests.

### E2E (Playwright)
- [x] `e2e/specs/planning/laundry-extra-trip.spec.js` (3) — preview / PUT partial / GET / summary entry
      `kind: 'extra'` / Planning mounts with the action-bar item / DELETE on a far-future Thursday;
      laundry-day 400; malformed date 400.

### Manual UI verification
- [x] 2026-08-19, dev DB: extra trip on Sunday 23/08 (linen dirty since Tuesday 18/08 + the 18/08 batch
      at the laundry) created as a partial pick-up from the dialog → the Sunday card shows À apporter /
      À récupérer (capped) + « reste à la blanchisserie : 1 simple »; the Tuesday 25/08 card recomputes
      (drop since Sunday, pick-up = remainder + Sunday's drop); « Disponible après ce dépôt » follows.
      Desktop + `xs` (390 px: short title, fullscreen dialog, stacked fields, no horizontal scroll).
- [x] Edit → « Tout récupérer »: caption gone, pick-up = the whole pool.
- [x] Delete (confirm dialog): the weekly cards return to their previous values.
- [ ] Reception account: not exercised in the browser (no reception session at hand) — covered by the
      server allowlist test and the card test without handlers; the Planning gating keys on the same
      `receptionMode` flag as every other reception restriction.

## 8. Out of scope

- Partial **drop-off** on an extra trip (the operator always brings all the dirty linen).
- Per-property extra trips (global, like skips and manual lines).
- Skipping an extra trip (delete it instead) or a free-text reason on the trip.
- A management list of extra trips under Paramètres › Blanchisserie (Planning is the only entry
  point — decision 2026-08-19).
- Modelling the laundry's turnaround: any batch is ready at the next trip (decision 2026-08-19).
- Listing an extra trip that falls after the inventory horizon when `GET /api/planning/laundry` is
  called without `to` (the range is capped at the horizon, like the regular days), and a « Disponible
  après ce dépôt » line on a past extra trip (the simulation starts today).

## 9. Open questions

Resolved during scoping (2026-08-19, AskUserQuestion):
- **What does the weekly trip after an extra trip fetch?** → **Everything at the laundry** (the linen
  dropped at the extra trip a few days before + any remainder), not only batches ≥ 7 days old.
- **Entry point** → the Planning action bar (dialog), **admin only** — the reception role sees the
  card but cannot create, edit or delete an extra trip. (Rejected: a list under Paramètres ›
  Blanchisserie, or both.)
- Assumptions stated in the rules, to be challenged at review: partial pick-up entered **per linen
  type** (prefilled with the pool, capped by it); past dates allowed; an extra trip cannot fall on the
  regular laundry day; manual lines allowed on extra dates and removed with the trip.

## 10. Implementation notes (2026-08-19)

- Engine equivalence: replacing the per-date batch ledger by the per-type pool left every existing
  `linen-inventory*` assertion untouched — the only special case is day `from` when `from` is itself
  the seeded regular trip (no pick-up that day, as before).
- Summary equivalence: the ledger reproduces today's `buildBlock` call sequence per regular day
  ((prev, T] then (prevPrev, prev]); the only payload change without extra trips is `kind: 'regular'`.
- The 35-day reservation lookback of `linenInventoryModel.simulate` is a correction (the seed batch of
  the last regular trip reaches 13 days back, the former fetch stopped at 7): the stock line and the
  Dashboard alert may show a few pieces less in the days after a trip — flagged in the changelog.
