# Establishment Closures (Fermetures de l'établissement)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/establishment-closures` _(Claude-managed)_ |
| **Created** | 2026-05-26 |
| **Author** | Adrien |
| **Spec type** | Dead-code revival + scope extension + MVC refactor + UI redesign |

---

## 1. Context

GuestFlow has an orphan "Establishment Closures" feature: code was written but never connected.

| Endroit | État actuel |
|---|---|
| [server/src/routes/establishmentClosures.js](server/src/routes/establishmentClosures.js) (121 LOC) | ✅ Exists — full CRUD with overlap detection logic |
| [client/src/pages/EstablishmentClosuresPage.js](client/src/pages/EstablishmentClosuresPage.js) (159 LOC) | ✅ Exists — `DataPageScaffold` + `FormDialog` UI |
| Mount in `server/src/index.js` | ❌ **Not mounted** — endpoints return 404 |
| Route in `client/src/App.js` | ❌ **Not routed** — page is unreachable |
| `api.js` (`getEstablishmentClosures`, `createEstablishmentClosure`, etc.) | ❌ **Methods missing** — page would crash if reachable |
| Table `establishment_closures` in `database.js` | ❌ **Not created** — inserts would crash |

The feature is **functionally needed** (closing the establishment for vacation, renovations, off-season periods to prevent any reservation from being accepted) but currently dormant. Time to connect it properly.

**Scope extension agreed in spec discussion:** instead of the current "all-properties" model (one closure blocks all logements at once), the new schema accepts a nullable `propertyId`:
- `propertyId IS NULL` → global closure (blocks all properties — annual vacation, general renovations).
- `propertyId IS NOT NULL` → per-property closure (single-logement renovation, e.g. one apartment's ravalement).

## 2. Goal

The user can:
1. **See the list of all upcoming and past closures**, with property scope visible (global or specific logement).
2. **Add a new closure** picking either "Tous les logements" or a specific property, plus a label + start/end dates.
3. **Edit / delete** existing closures.
4. **Be blocked at the server level** from creating overlapping closures or closures that conflict with existing reservations.
5. **See closures on the Calendar (`/calendar`)** as gray striped bands — same visual weight as a reservation but unmistakably "closed period". Drag-creating a reservation on those dates is blocked (the dates are reported as occupied by the existing `getOccupiedDates` endpoint).

UI redesign: replace `DataPageScaffold` with the shared `PageActionBar` (sticky bar + icon-only "Ajouter une fermeture" action), keep the simple table layout below. Consistent with the new design system.

## 3. Functional rules

### General

1. A closure has: `id`, `propertyId?` (nullable FK), `label`, `startDate`, `endDate`, `createdAt`, `updatedAt`.
2. `label` defaults to "Fermeture établissement" if empty on submit, then `sentenceCase` applied (consistent with existing util).
3. `startDate < endDate` required (server-side, returns `400 INVALID_RANGE`).
4. Closures are listed sorted by `startDate ASC, id ASC`.

### Per-property semantics

5. `propertyId IS NULL` = **global closure** (applies to every property). Cannot overlap with any reservation across all properties, nor with any other closure (global or per-property).
6. `propertyId = X` = **per-property closure** (applies only to property X). Cannot overlap with any reservation on property X, nor with any global closure, nor with any other closure on property X.
7. Two per-property closures on **different** properties can overlap freely (they don't conflict).
8. Conflict detection uses the same night-block semantics as the existing code: early check-in (≤ 10h) extends the reservation's effective start to the previous day; late check-out (≥ 17h) extends the effective end to the next day.

### Validation (server-side)

9. Returns `400 INVALID_RANGE` with French message if `startDate >= endDate`.
10. Returns `409 RESERVATION_OVERLAP` with French message naming the offending reservation (property name + dates) if any conflicting reservation exists.
11. Returns `409 CLOSURE_OVERLAP` with French message if another closure already covers the period (per the per-property semantics above).
12. Returns `404` if updating/deleting a non-existent closure.
13. Returns `400 INVALID_PROPERTY` if `propertyId` is provided but the property doesn't exist.

### Side effects on existing flows

14. The reservation routes (`POST /api/reservations` and `PUT /api/reservations/:id`) **must reject** reservations that fall on a covered period. This requires a small addition to the existing reservation creation/update validation. Returns `409 CLOSURE_COVERS_DATE` with a French message naming the closure label + range. (Today this validation does NOT exist because the closures feature itself never ran.)
15. The `getOccupiedDates` endpoint (`GET /api/reservations/occupied-dates/:propertyId`) **is extended** to include dates covered by an applicable closure (global or per-property targeting the queried property). Shape kept as `string[]` for backward compatibility — closure dates are appended like reservation-occupied dates. The Calendar uses this to block drag-create on those dates.
16. The Calendar page (`/calendar`) renders closures as **gray striped bands** spanning the closure range, visually distinct from reservation bands. The user sees at a glance that those dates are off-limits. Loaded via a new filterable `GET /api/establishment-closures?propertyId=X&from=Y&to=Z` query so the Calendar only fetches what it needs for the visible month.

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** All overlap/validation logic stays on the server.

### 4.1 Server side (`server/src/`)

#### Current state

| Layer | File | T/C | Current responsibility |
|---|---|---|---|
| `routes/establishmentClosures.js` (121 LOC) | T | T | Full inline CRUD with overlap detection. Not mounted in `index.js`. |
| `controllers/` | — | — | (none) |
| `models/` | — | — | (none) |
| `utils/` | — | — | (none — `textFormatters.sentenceCase` already used inline) |
| `database.js` | T | T | **Table `establishment_closures` not created**. Referenced only from `routes/establishmentClosures.js`. |
| `routes/reservations.js` | T | T | Does not check for closures — a reservation can be created on a closed date. |
| `index.js` | T | T | Router not mounted. |

#### Target state

| Layer | File | T/C | Target responsibility |
|---|---|---|---|
| `routes/establishmentClosures.js` | T | T | **Thin** — 4 routes wired to controller. |
| `controllers/establishmentClosuresController.js` | C | C | `list`, `create`, `update`, `delete`. Orchestrates validation + model. |
| `models/establishmentClosuresModel.js` | C | C | Sole DB access: `list()`, `findById(id)`, `insert(payload)`, `update(id, payload)`, `delete(id)`, `findReservationOverlap(propertyId, startDate, endDate)`, `findClosureOverlap(propertyId, startDate, endDate, excludeId?)`, `findCoveringClosure(propertyId, date)` (helper used by reservation validation). Factory `(db) => {...}` for testability. |
| `utils/establishmentClosuresValidation.js` | C | C | Pure helper `validateRange(startDate, endDate)`. (Overlap detection involves DB queries, so stays in the model layer.) |
| `database.js` | T | T | Add `CREATE TABLE IF NOT EXISTS establishment_closures` with FK to `properties(id) ON DELETE CASCADE` (nullable). Add index on `(propertyId, startDate, endDate)` (added to `utils/dbHygiene.js` `FK_INDEXES` catalog). |
| `routes/reservations.js` | T | T | (a) On POST and PUT, after the existing validation, call `establishmentClosuresModel.findCoveringClosure(propertyId, startDate, endDate)` — reject with `409 CLOSURE_COVERS_DATE` if a global or per-property closure covers any night of the requested range. (b) `getOccupiedDates` endpoint (the `GET /occupied-dates/:propertyId` handler at line 344) appends closure-covered date strings to its returned array via a new model helper. |
| `index.js` | T | T | Add `app.use('/api/establishment-closures', require('./routes/establishmentClosures'));`. |

### 4.2 Client side (`client/src/`)

#### Consumed (existing)

| Component | Used for |
|---|---|
| `PageActionBar` | Sticky header with title + "Ajouter une fermeture" custom action (in `actionsBefore`). |
| `FormDialog` | Add / edit modal. |
| `ConfirmDialog` (via `useAppDialogs`) | Delete confirmation. |
| `TableCard` | Wrapper for the closures table (consistent with Settings sub-tables and other places). |

#### Created — none (no new generic component needed)

#### Specific — kept feature-local

| File | Purpose |
|---|---|
| `pages/EstablishmentClosuresPage.js` | Refactored: PageActionBar + TableCard + dialog. ~150 LOC. |
| `pages/CalendarPage.js` | **Targeted addition only** (this file is 2300+ LOC and its full refactor is Bloc 3 — we do NOT touch the rest here). Add: `closures` state, fetch via `api.getEstablishmentClosures({ propertyId: selectedProp, from, to })` in `loadCalendarData`, and a helper `getClosureForDate(dateStr)` that returns the closure object (or null) for a given date. Render bands per the §6.6 visual spec. Total diff target: under ~80 LOC added, no other logic touched. |
| `utils/closureCalendar.js` | New small helper: `expandClosuresToDates(closures)` → `string[]` of every date covered (inclusive start, exclusive end, matching reservation conventions). Used both by CalendarPage and by the server-side `getOccupiedDates` extension via a parallel helper in the model. |

#### API client

`client/src/api.js` adds:
```js
getEstablishmentClosures: (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/establishment-closures${qs ? `?${qs}` : ''}`);
},
createEstablishmentClosure: (data) => request('/establishment-closures', { method: 'POST', body: data }),
updateEstablishmentClosure: (id, data) => request(`/establishment-closures/${id}`, { method: 'PUT', body: data }),
deleteEstablishmentClosure: (id) => request(`/establishment-closures/${id}`, { method: 'DELETE' }),
```

The same `getEstablishmentClosures` method serves both:
- The CRUD page (no params → returns all closures).
- The Calendar (`{ propertyId, from, to }` → returns closures applicable to that property — global + same-property — overlapping the date range).

### 4.3 API contract

| Method | Endpoint | Query / Body | Response |
|---|---|---|---|
| GET | `/api/establishment-closures` | Optional query: `propertyId`, `from`, `to`. Without any param → all closures. With `propertyId` → only closures applicable to that property (i.e. `propertyId IS NULL` OR `propertyId = X`). With `from`/`to` → restrict to closures whose range overlaps `[from, to)`. | `[{ id, propertyId, propertyName?, label, startDate, endDate, updatedAt }, ...]` ordered by `startDate ASC, id ASC`. `propertyName` joined when `propertyId` is non-null. |
| POST | `/api/establishment-closures` | `{ propertyId?, label, startDate, endDate }` | `{ id }` on success. `400 INVALID_RANGE` / `400 INVALID_PROPERTY` / `409 RESERVATION_OVERLAP` / `409 CLOSURE_OVERLAP`. |
| PUT | `/api/establishment-closures/:id` | Same as POST | `{ ok: true }` or 404 / 400 / 409. |
| DELETE | `/api/establishment-closures/:id` | — | `{ ok: true }`. |
| GET | `/api/reservations/occupied-dates/:propertyId` _(existing — extended)_ | `from`, `to`, optional `excludeReservationId` | Same `string[]` shape as before, now **including** date strings covered by applicable closures (global + same-property). Backward-compatible. |
| POST/PUT | `/api/reservations` / `/api/reservations/:id` _(existing — extended)_ | Same payload as today | Adds `409 CLOSURE_COVERS_DATE` with French message naming the closure label + range when the requested range overlaps an applicable closure. |

Error response shape: `{ error: "French message", code: "INVALID_RANGE" \| "RESERVATION_OVERLAP" \| "CLOSURE_OVERLAP" \| "INVALID_PROPERTY" \| "CLOSURE_COVERS_DATE" }`.

## 5. Data model

### New table

```sql
CREATE TABLE IF NOT EXISTS establishment_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  propertyId INTEGER,
  label TEXT NOT NULL DEFAULT 'Fermeture établissement',
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
);
```

### New index (added to `utils/dbHygiene.js`)

```sql
CREATE INDEX IF NOT EXISTS idx_establishment_closures_propertyId_dates
  ON establishment_closures(propertyId, startDate, endDate);
```

Speeds up the overlap-detection queries that look up closures by `(propertyId, dateRange)` on every reservation create/update.

### Data impact

- Fresh DB: table is created on first boot.
- Existing DB (where the table never existed because the route was never mounted): `CREATE TABLE IF NOT EXISTS` is idempotent — first boot just creates the empty table. No data migration needed.
- No existing data to preserve.

## 6. UI / UX

### 6.1 Page structure

```
┌── PageActionBar ──────────────────────────────────────────────────┐
│ Fermetures de l'établissement                  [➕]                │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│ Logement              Libellé              Début       Fin   [🗑] │  ← every row is clickable → edit
│ ───────────────────────────────────────────────────────────────── │
│ Tous les logements    Congé annuel         01/08/2026  31/08/...  │
│ Villa Sunset          Ravalement façade    10/09/2026  20/09/...  │
│ Tous les logements    Travaux toiture      05/11/2026  12/11/...  │
└───────────────────────────────────────────────────────────────────┘
```

- `PageActionBar` title: "Fermetures de l'établissement".
- `actionsBefore` (only icon): `{ icon: <AddIcon />, tooltip: "Ajouter une fermeture", onClick: openCreateDialog, color: 'primary', variant: 'contained' }`. No `onSave`/`onCancel` since this is a list page (the dialog handles its own save).
- Table inside `TableCard`, max-width 920 centered.
- Empty state: "Aucune fermeture configurée".
- Each row is **clickable** (cursor pointer + hover background): clicking anywhere on the row opens the edit dialog. Only the delete IconButton (right column) is an explicit affordance; it uses `stopPropagation` so it doesn't trigger the row-level edit handler.
- Row content: property name (or "Tous les logements" italic gray for global), label, start, end, then the delete icon in the Actions column.

### 6.2 Add / Edit dialog

`FormDialog` title: "Ajouter une fermeture" / "Modifier la fermeture".

Fields:
1. **Logement concerné** (`Select`): "Tous les logements" (default sentinel `'ALL'`) + list of properties from `api.getProperties()`. Sentinel converted to `null` in the save payload.
2. **Libellé** (`TextField`).
3. **Début de fermeture** (`DatePicker` MUI X, `AdapterDayjs`, locale `fr`, format `DD/MM/YYYY`).
4. **Réouverture** (`DatePicker` MUI X, controlled `open` state, `minDate = startDate + 1`, helper text `"Premier jour à nouveau disponible. Ex : du 15 au 16 = un seul jour fermé (le 15)."`).

**Two-step date-picking UX:**
- The user clicks the **Début de fermeture** picker → chooses a date → `onAccept` fires.
- On accept, the start date is stored and the **Réouverture** picker is opened programmatically (`open={endDateOpen}` controlled state).
- The reopening date is **pre-filled to `startDate + 1`** (= one closed day = the start day) whenever the current value is empty OR `<= startDate` (invalid range). This makes "fermer un seul jour" a single click: accept the start, accept the suggested reopening date, save.
- The reopening picker has `minDate = startDate + 1` so the user can't pick an invalid range.

**Semantics:** `endDate` is **exclusive** — it is the day of reopening, not the last closed day. This mirrors the reservation convention (`endDate` = checkout day, not included in the stay). Helper text on the **Réouverture** picker makes this explicit with an example.

Submit disabled if `!startDate || !endDate || startDate >= endDate`.

Server error → red `Alert` inside the dialog (`409 RESERVATION_OVERLAP` shows the offending reservation; `409 CLOSURE_OVERLAP` shows a generic message).

### 6.3 Sidebar entry

Placed inside the existing **Paramètres** sub-menu (alongside Options, Resources, Clients, Vacances scolaires, etc.) — closures are an administrative configuration concern and group naturally with the other settings items.

In `client/src/App.js`, the new item is added inside the `Collapse in={settingsMenuOpen}` block, after "Vacances scolaires":
```jsx
<ListItemButton
  component={Link}
  to="/establishment-closures"
  selected={location.pathname === '/establishment-closures'}
>
  <ListItemIcon><EventBusyIcon fontSize="small" /></ListItemIcon>
  <ListItemText primary="Fermetures" />
</ListItemButton>
```

The `'/establishment-closures'` path is also added to the conditions that keep `settingsMenuOpen = true` (so the sub-menu stays expanded while the user is on the closures page) and to the parent's `selected` predicate (so Paramètres stays highlighted).

### 6.4 Responsive

| Breakpoint | Behavior |
|---|---|
| `xs` (≤600px) | PageActionBar compact. Table wraps in horizontal-scroll container (`TableCard`'s default). Dialog `fullScreen={true}`. Form fields full-width. |
| `md` (~900px) | Standard layout. |
| `lg` (≥1200px) | Container capped at 920px. |

### 6.5 Calendar visualization

On `CalendarPage`, every cell whose date falls inside an applicable closure (global or same-property) renders an **overlay layer** with:

- Background: diagonal striped pattern in `grey.400` (CSS `repeating-linear-gradient(135deg, rgba(0,0,0,0.08), rgba(0,0,0,0.08) 8px, rgba(0,0,0,0.16) 8px, rgba(0,0,0,0.16) 16px)` or equivalent).
- Border: dashed `grey.500` 1px on top + bottom of the band.
- Label inside the band (on the first day of the closure range within the visible month, or the first visible day if the closure starts before): the closure `label` truncated, in `text.disabled` italic small.
- Tooltip on hover: `"<label> — du <startDate> au <endDate>"`.
- z-index: above the empty cell, below any reservation band (so an existing reservation stays clearly visible if both happen to overlap — they shouldn't but defensive).

Drag-create on a closed day is **disabled** — the existing drag handlers already gate on `occupiedDates.includes(dateStr)`; since closures now appear in that array, the gating works automatically without further changes to drag logic.

If a closure spans multiple months, the band continues into each visible month (the visual is computed per-cell, not per-range).

**Out of scope for this spec:** showing closures in `Dashboard`, `MiniPlanningStrip`, `PlanningPage`, or `PropertyCalendarOverview`. Those will follow when each page is touched in its own retro-spec.

### 6.6 Strings (FR — Calendar)

- Tooltip on a closed cell: `"<label> — du <startDate> au <endDate>"`
- Default band label fallback when truncated: `Fermé`

### 6.7 Strings (FR — CRUD page)

- Title : `Fermetures de l'établissement`
- Action tooltip : `Ajouter une fermeture`
- Empty state : `Aucune fermeture configurée`
- Column headers : `Logement`, `Libellé`, `Début`, `Fin`, `Actions`
- Cell placeholder when global : `Tous les logements` (italic, `text.disabled`)
- Dialog titles : `Ajouter une fermeture` / `Modifier la fermeture`
- Dialog labels : `Logement concerné`, `Libellé`, `Début fermeture`, `Fin fermeture`
- Save : `Enregistrer` ; Cancel : `Annuler`
- Confirm delete : `Supprimer cette période de fermeture ?` (`Supprimer` / `Annuler`)
- Default label : `Fermeture établissement`
- Errors :
  - `INVALID_RANGE` : `La date de fin doit être postérieure à la date de début.`
  - `INVALID_PROPERTY` : `Logement introuvable.`
  - `RESERVATION_OVERLAP` : `Fermeture impossible : une réservation existe déjà sur cette période (<nom logement>, du <début> au <fin>).`
  - `CLOSURE_OVERLAP` : `Cette période chevauche déjà une fermeture existante.`

## 7. Test plan

### Server unit tests

**`tests/establishment-closures-validation.unit.test.js`** — pure helper:
- [ ] `validateRange('2026-07-01', '2026-07-05')` → `null`
- [ ] `validateRange('2026-07-05', '2026-07-01')` → French error
- [ ] `validateRange('', '2026-07-05')` → French error (dates required)

**`tests/establishment-closures-model.unit.test.js`** — `:memory:` DB:
- [ ] `insert` + `list` returns the row sorted.
- [ ] `list({ propertyId })` filters to global + same-property closures.
- [ ] `list({ propertyId, from, to })` further restricts to range overlap.
- [ ] `findReservationOverlap` detects a global closure conflicting with a reservation across any property.
- [ ] `findReservationOverlap` detects a per-property closure conflicting only with that property's reservations.
- [ ] `findReservationOverlap` correctly applies the early-check-in (≤10h) and late-check-out (≥17h) night-block expansions.
- [ ] `findClosureOverlap` for a global closure conflicts with any existing closure (global or per-property).
- [ ] `findClosureOverlap` for a per-property closure conflicts with: existing global, existing closure on same property; **not** with closures on other properties.
- [ ] `findCoveringClosure(propertyId, startDate, endDate)` returns the row when a global closure covers the range, or when a per-property closure covers the range for that property. Returns `null` when only another property is closed during that range.
- [ ] `expandClosuresToDates([...])` yields the correct `string[]` of every date in each range (start inclusive, end exclusive), used by the server side of `getOccupiedDates`.

### Manual UI verification

#### Desktop (~1200px)
- [ ] Open Fermetures → page loads with PageActionBar title + "+" icon, empty table state visible.
- [ ] Click "+" → dialog opens. Default logement is "Tous les logements".
- [ ] Click the **Début de fermeture** field → mini calendar opens. Pick a date → the calendar closes, the **Réouverture** mini calendar opens automatically with `startDate + 1` pre-selected.
- [ ] Validate the suggested reopening date → save → 1-day closure created (start day is closed, the next day is again available).
- [ ] Try to pick a reopening date ≤ start date → the day is disabled (`minDate = startDate + 1`).
- [ ] When editing a closure with `startDate = X`, `endDate = X + 1`, the Réouverture field shows `X + 1` (no surprise).
- [ ] Add a global closure for next week → row appears with "Tous les logements" italic gray.
- [ ] Add a per-property closure for one property → row appears with the property name.
- [ ] Try to add another global closure overlapping the first → red Alert in dialog: `CLOSURE_OVERLAP`.
- [ ] Try to add a per-property closure overlapping an existing reservation → red Alert with the reservation name.
- [ ] Click anywhere on a row → edit dialog opens pre-filled with that row.
- [ ] Click the trash icon → does NOT open the edit dialog (stopPropagation), confirm dialog appears instead.
- [ ] Edit a closure → form pre-filled, save updates the row.
- [ ] Delete → confirm dialog → row gone.
- [ ] After a global closure is created, try to create a reservation on that property during the closed period → API returns `409 CLOSURE_COVERS_DATE` (UI behavior of reservation form is out of scope, but the server rejection is asserted).
- [ ] After a per-property closure on property A, try to create a reservation on property B for the same period → succeeds (different property).

#### Calendar visualization (new)
- [ ] Open `/calendar`, select a property that has an upcoming global closure → the closure dates appear as gray striped bands across all visible cells of the closure range. Tooltip shows the label + dates.
- [ ] Same with a per-property closure on the selected property → bands appear.
- [ ] Select another property → only the global closures still appear (per-property closures of property A are NOT shown when viewing property B).
- [ ] Drag-create a reservation across a closed date → drag handlers block, no reservation form opens (because `occupiedDates` includes the closure dates).
- [ ] Closures spanning multiple months: navigate forward → the band continues into the next month.

#### Mobile (`xs`)
- [ ] PageActionBar compact, "+" icon still visible.
- [ ] Table scrolls horizontally inside its container.
- [ ] Dialog opens fullscreen.

#### Sidebar
- [ ] "Fermetures" item visible top-level, leads to `/establishment-closures`.

## 8. Out of scope

- **Showing closures inside `Dashboard`, `MiniPlanningStrip`, `PlanningPage`, `PropertyCalendarOverview`.** Only the main `CalendarPage` is updated here. The other surfaces will follow when each is touched in its own retro-spec.
- **Recurring closures** (e.g. "every weekend"). Out of scope; one-shot date ranges only.
- **Audit history for closures**. Closures are rarely changed and the create/update/delete actions are explicit enough — no audit log table needed at this stage.
- **Full refactor of `CalendarPage.js`** (2300+ LOC). Only a targeted, < ~80-LOC addition is made here for closure rendering. The full refactor is the Bloc 3 CalendarPage spec.

## 9. Open questions

- Q: When a user tries to create a reservation overlapping a closure, the server returns `409 CLOSURE_COVERS_DATE`. Should the reservation form proactively warn the user before submit?
  - **A: Already covered.** `getOccupiedDates` is extended in this spec to include closure dates, so the Calendar's existing drag-gate logic already prevents the user from drag-creating on a closed day. The `409` is the safety net for any other code path that bypasses the calendar (programmatic creation, etc.).
- Q: Should deleting a property cascade-delete its per-property closures?
  - **A:** Yes — `FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE`. Closures targeting a deleted property are meaningless.
- Q: Should the closure ranges use date-only (`YYYY-MM-DD`) or include times like reservations do?
  - **A:** Date-only. Closures are "from day X morning to day Y morning" in the same convention as reservations (`endDate` is exclusive of the last full day). The existing night-block expansion in the overlap detection makes this consistent with reservation semantics.
- Q: For the Calendar visual, do we share the same colored band style as reservations or use a distinct style?
  - **A: Distinct style — gray striped pattern.** A closure must not be confused with a reservation. The striped gray reads as "unavailable / off-limits" rather than "someone has booked this".

---

## 10. Tech debt addressed

- Orphan dead code becomes a working feature (table created, route mounted, page routed, API methods exposed, sidebar entry added).
- Per-property scoping eliminates a future limitation.
- MVC extraction (controller + model + validation util) — consistent with the codebase-wide refactoring policy.
- Reservation-vs-closure conflict detection now actually runs (used to be dead code, so the validation logic was never exercised).
- `getOccupiedDates` is extended to include closure dates — closures now show up everywhere the existing occupancy gating is consumed (Calendar drag-gate, etc.) with no per-consumer change.
- Sidebar gains a clearer top-level entry for an admin function that was completely hidden.
- Page migrated to the shared `PageActionBar` design system.
- Calendar now visualizes closures — admin sees at a glance which dates are off-limits on the property they're looking at.

## 11. Deferred (separate future specs)

- Closure visualization on `Dashboard`, `MiniPlanningStrip`, `PlanningPage`, `PropertyCalendarOverview` (each picked up when its page is touched).
- Recurring-closure templates.
- Closure audit history.
- Full `CalendarPage.js` refactor (Bloc 3 spec).
