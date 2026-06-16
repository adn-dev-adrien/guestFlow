# Manual linen additions to a laundry trip

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/manual-laundry-additions` |
| **Created** | 2026-06-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md), [linen-inventory-shortage-tracking.md](linen-inventory-shortage-tracking.md), [skip-laundry-trip.md](skip-laundry-trip.md) |

---

## 1. Context

The Planning shows a **laundry card** (`LaundryDayCard`) on each laundry day with three blocks,
all computed **from reservations**:
- **À apporter** (drop-off) — linen used since the previous trip, going to the laundry.
- **À récupérer** (pick-up) — the previous batch coming back, clean.
- **Disponible après ce dépôt** — the clean stock after the drop (inventory simulation).

Today every count is derived from reservations only. The operator sometimes needs to wash
linen **not tied to a reservation** (owner's own use, a one-off, a correction) and wants it to
**enter the calculation** for a given trip.

Decision (AskUserQuestion 2026-06-16): **per-type + full cycle** — the manual addition is entered
per linen type and behaves like dirty linen of that trip: it joins **À apporter**, comes back
clean on the next trip (**À récupérer**), and impacts the **Disponible après ce dépôt** stock.

## 2. Goal

On any laundry card, the operator can add a **manual quantity per linen type** (draps : simple /
double / bébé ; serviettes : grande / moyenne / petite) for that trip. The amounts fold into the
trip's drop-off, the next trip's pick-up, and the inventory simulation — exactly like the
reservation-driven linen, so the three blocks stay consistent. Manual additions are **global per
trip date** (one human, one trip per day — same scope as skips).

## 3. Functional rules

1. **Per-trip, per-type, global.** A manual addition is keyed by the laundry **trip date**
   (`YYYY-MM-DD`) and holds six non-negative integers: `singleBeds`, `doubleBeds`, `babyBeds`,
   `largeTowels`, `mediumTowels`, `smallTowels`. One row per date, global (not per-property),
   matching the skip model.
2. **À apporter.** The trip's drop-off = reservation linen in the window **plus** the manual
   additions whose trip date falls in that same (widened) window. Concretely the summary's
   `buildBlock(startExclusive, endInclusive)` adds the manual additions of every laundry day in
   `(startExclusive, endInclusive]`.
3. **À récupérer.** Pick-up(L) = drop-off(previous trip). Because pick-up reuses the same windowed
   block one non-skipped step back, the previous trip's manual additions automatically come back
   as the returning clean batch — no extra wiring.
4. **Disponible après ce dépôt (inventory).** On a non-skipped laundry day, the manual addition is
   treated as clean stock taken to be washed: at the drop it moves **clean → at-laundry** (clean
   decreases by the manual amount that day) and returns **at-laundry → clean** on its pick-up
   (+7 days, or the next non-skipped trip). Conservation holds (what leaves clean returns), so the
   engine's no-phantom-linen invariant is preserved.
5. **Skip carry-forward.** If a trip date is skipped, its manual additions are **not** dropped that
   day; they defer and are dropped on the **next non-skipped** laundry day, alongside the deferred
   reservation backlog — identical to how reservation linen behaves under a skip
   ([skip-laundry-trip.md](skip-laundry-trip.md) §3.2).
6. **Editing.** Setting the six values for a date **upserts** the row. Setting all six to zero
   **deletes** the row (no empty rows; the trip reverts to reservation-only). Negative inputs are
   clamped to 0 server-side (authoritative).
7. **No reservation coupling.** Manual additions never touch reservations, options, or the
   complement/finance — they are purely a linen-trip overlay.
8. **Hide-when-empty unchanged.** A trip with zero reservation linen but non-zero manual additions
   now renders (the card's both-sides-zero hide rule already sums all six types, so a manual
   addition makes a side non-zero and the card shows).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | C/T | Responsibility |
|---|---|---|---|
| database | `database.js` | T | Idempotent `CREATE TABLE IF NOT EXISTS laundry_trip_manual_additions` (PK `tripDate`, the six integer columns, `updatedAt`). |
| models | `models/laundryManualAdditionsModel.js` | C | `get(date)→{6 types}` (zeros if no row); `set(date, counts)` (clamp ≥0, upsert, delete-when-all-zero); `listAll()→{date: counts}` + `sumForWindow(startExcl, endIncl)→{6 types}`. Factory `create(db)` + default. Mirrors `laundryTripSkipsModel`. |
| models | `models/linenInventoryModel.js` | T | `simulate()` also loads the manual additions (as a `Map<date,counts>`) and passes them to `simulateInventory`. |
| utils | `utils/linenInventory.js` | T | `simulateInventory` accepts `manualAdditionsByDate` (default empty Map). On each non-skipped laundry-day drop, the manual additions for the laundry days covered by that drop are washed (clean → at-laundry → clean on pick-up, rule 4 + 5). |
| controllers | `controllers/planningController.js` | T | `laundrySummary` adds `laundryManualAdditionsModel.sumForWindow(startExcl, endIncl)` into each `buildBlock` (rule 2/3). |
| controllers | `controllers/laundryManualAdditionsController.js` | C | `GET /api/laundry/manual-additions` (list, optional `?from&to`) + `PUT /api/laundry/manual-additions/:date` (set). Thin, mirrors `laundryTripSkipsController`. |
| routes | `routes/*` (laundry) | T | Wire the two endpoints next to the existing `/api/laundry/skips`. |

### 4.2 Client side (`client/src/`)

| Layer | File | C/T | Responsibility |
|---|---|---|---|
| components | `components/LaundryDayCard.js` | T | Header gains an **edit (pencil) IconButton** (next to the skip toggle) → opens the editor. The drop-off / pick-up / inventory totals already render whatever the server sends (manual folded in). A subtle indicator (the pencil filled / a small « ✎ » caption) shows when manual additions exist. |
| components | `components/LaundryManualAdditionsDialog.js` | C | Small dialog: six steppers grouped « Draps » (simple / double / bébé) + « Serviettes » (grande / moyenne / petite), pre-filled with the trip's current values; Save / Annuler. `fullScreen` on `xs`. Reuses existing patterns (no new generic needed beyond this feature dialog). |
| pages | `pages/PlanningPage.js` | T | Fetch the manual additions alongside the laundry summary; pass each card its values + an `onEditManual(date, counts)` handler that PUTs then reloads the planning (same optimistic-reload pattern as `onToggleSkip`). |
| services | `api.js` | T | `getLaundryManualAdditions({from,to})` + `setLaundryManualAddition(date, counts)`. |

### 4.3 API contract

- `GET /api/laundry/manual-additions?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ additions: { 'YYYY-MM-DD': { singleBeds, doubleBeds, babyBeds, largeTowels, mediumTowels, smallTowels }, … } }` (only non-empty trips).
- `PUT /api/laundry/manual-additions/:date` body `{ singleBeds?, doubleBeds?, babyBeds?, largeTowels?, mediumTowels?, smallTowels? }` → upsert (missing → 0); all-zero deletes the row. 400 on a non-ISO date. Returns the stored row (or zeros).

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS laundry_trip_manual_additions (
  tripDate     TEXT PRIMARY KEY,            -- ISO YYYY-MM-DD, one trip per day (global)
  singleBeds   INTEGER NOT NULL DEFAULT 0,
  doubleBeds   INTEGER NOT NULL DEFAULT 0,
  babyBeds     INTEGER NOT NULL DEFAULT 0,
  largeTowels  INTEGER NOT NULL DEFAULT 0,
  mediumTowels INTEGER NOT NULL DEFAULT 0,
  smallTowels  INTEGER NOT NULL DEFAULT 0,
  updatedAt    TEXT DEFAULT (datetime('now'))
);
```
Idempotent in `database.js`. No impact on existing rows/tables — purely additive.

## 6. UI / UX

- **Laundry card**: an edit pencil IconButton in the header (laundry accent colour), left of / next to
  the skip toggle. When manual additions exist, the card shows a discreet caption under À apporter
  (e.g. « dont ajout manuel »); the numeric totals already include them.
- **Editor dialog**: title « Ajouter du linge — <date> ». Two groups of steppers (Draps / Serviettes),
  each type a `−  n  +` row (reuse the SAS `CountStepper` look). « Enregistrer » (PUT) / « Annuler ».
  `fullScreen` on `xs`; touch targets ≥ 44 px.
- **Responsive**: steppers stack on `xs`; the card layout is unchanged otherwise.
- **Read-only surfaces**: cards rendered without an `onEditManual` handler show no pencil (same rule as
  the skip toggle).

## 7. Test plan

### Server unit tests
- [x] `laundryManualAdditionsModel`: get defaults to zeros; set clamps negatives, upserts, deletes on
  all-zero; `sumForWindow` sums only dates in `(startExcl, endIncl]`.
- [x] `planningController.laundrySummary`: a manual addition on a trip date appears in that trip's
  drop-off and in the next trip's pick-up (with a stubbed model).
- [x] `linenInventory.simulateInventory`: a manual addition reduces clean stock on its drop day and
  restores it on pick-up (conservation); deferred to the next non-skipped trip when the date is
  skipped; no phantom linen (engine invariant holds).
- [x] `laundryManualAdditionsController`: GET shape; PUT upsert + all-zero delete + 400 on bad date.

### Client unit tests
- [x] `LaundryDayCard`: renders the edit pencil only with `onEditManual`; clicking opens the dialog;
  the card shows even when only manual additions are non-zero.
- [x] `LaundryManualAdditionsDialog`: pre-fills current values; Save calls back with the six counts.

### Manual UI verification (dev server)
- [x] Add 2 draps doubles + 3 serviettes grandes to a trip → À apporter increases by those, the next
  trip's À récupérer reflects them, « disponible après » drops then recovers. Mobile editor works.

## 8. Out of scope

- Per-property manual additions (global only, like skips).
- Recurring / templated manual additions (one-off per trip).
- A manual addition that is *external* linen not drawn from the tracked stock (we model it as tracked
  stock washed and returned — rule 4).
- Editing manual additions from anywhere other than the laundry card.

## 9. Open questions

- **Resolved 2026-06-16 (AskUserQuestion):** per-type input + full cycle (À apporter + À récupérer +
  inventory impact).
- **Resolved 2026-06-16 (AskUserQuestion):** the card **folds** manual additions into the À apporter /
  À récupérer / disponible-après totals, with a discreet « dont ajout manuel » caption (no separate line).
