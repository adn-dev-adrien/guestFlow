# Linen inventory & shortage projection

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/linen-inventory-shortage-tracking` |
| **Created** | 2026-06-03 |
| **Approved** | 2026-06-03 |
| **Implemented** | 2026-06-03 |
| **Author** | Adrien |
| **Depends on** | [weekly-bed-linen-tracking.md](weekly-bed-linen-tracking.md) (uses the same options, same property defaults, same window/weekday math) |
| **Related PR** | _(opened after plan validation)_ |

---

## 1. Context

The weekly bed-linen tracking already tells Adrien how many sheet sets and towel sets he must
bring / pick up at the laundry on the configured laundry day. What it doesn't tell him:

- How much linen does he actually have in stock total?
- Will he run out next Tuesday because half the stock is at the laundry and the rest is on
  guests' beds + the next two arrivals need three doubles each?
- When exactly will the first shortage hit, on which type, and which reservation will be
  affected?

Today he runs this in his head. With more reservations and the auto-add of linen via property
defaults (spec `weekly-bed-linen-tracking.md` §3.7), the mental model is breaking — he wants
the app to project the inventory day by day until the last known reservation and warn him
ahead of any rupture.

## 2. Goal

Adrien declares his total stock (single / double / baby sheet sets + large / medium / small
towel sets, global across all properties) in a dedicated Settings sub-menu. The app:

- Simulates the inventory day by day from today to the last known reservation's `endDate`.
- Surfaces the "stock available after this drop-off" line on every laundry card in the
  Planning, with red highlighting on any type that goes negative.
- Surfaces a red, grouped-by-type alert on the Dashboard listing every projected shortage
  with the first shortage date, the missing quantity, and the impacted reservations.

## 3. Functional rules

### 3.1 Stock declaration

1. The user sets six integer values, ≥ 0, stored globally on the `app_settings` singleton:
   `bedLinenStockSingle`, `bedLinenStockDouble`, `bedLinenStockBaby`,
   `towelStockLarge`, `towelStockMedium`, `towelStockSmall`. All default to `0` on a fresh
   install. A `0` stock means "I don't track this type" — the simulation skips it (no
   shortage ever raised on a type with stock 0).

2. The stock is **shared across all properties** (Adrien's explicit constraint). The
   simulation aggregates demand across the entire portfolio.

### 3.2 Per-day state model

3. The simulation models four buckets per type:
   - **`clean`** — sets currently in the closet, available for the next check-in.
   - **`inCirculation`** — sets currently installed on a bed (active reservation).
   - **`dirty`** — sets sitting in the dirty pile after a checkout, waiting for the next
     laundry day.
   - **`atLaundry`** — sets at the laundry service, will return on the next laundry day.

   Conservation invariant: `clean + inCirculation + dirty + atLaundry = totalStock` on every
   day, for every type. Asserted by tests.

4. **Initial state** at day `today` (the snapshot BEFORE today's own check-ins/pick-ups run):
   - `inCirculation[type]` = sum over reservations that **already arrived before** `today` and are
     still staying (`startDate < today AND endDate > today`) of the linen contract for that type.
     Reservations arriving **on** `today` are NOT pre-counted here — the day-`today` iteration of the
     simulation checks them in (clean → inCirculation). **Fixed 2026-06-12:** this bound was
     previously `startDate <= today`, which combined with the same-day check-in step double-counted
     today's arrivals, inflating consumption and producing phantom shortages.
   - `atLaundry[type]` = sum of drop-offs computed for laundry days in `(today - 7, today]`
     that haven't been picked up yet. On the laundry-day cycle, this equals exactly the
     drop-off computed for the most recent past laundry day before `today` (rule 8 of the
     weekly spec). **Fixed 2026-06-16:** when `today` is itself a laundry day, this initial
     `atLaundry` batch is keyed under `today` in the drop-off ledger; a same-day drop-off (e.g. a
     manual addition entered for today — `manual-laundry-additions.md`) must be **merged** into that
     batch, not overwrite it. Overwriting lost the initial batch's pick-up record, stranding it « at
     laundry » forever → a phantom permanent shortage a week-plus later (observed on prod: a 1-double
     manual addition on a Tuesday hid 6 doubles and faked a « rupture » 17 days out).
   - `dirty[type]` = sum over reservations whose endDate is in `(lastLaundryDay, today]`
     and that are NOT yet at the laundry (i.e. their dirty linen sits there waiting for
     the next drop-off).
   - `clean[type]` = `totalStock[type] - inCirculation - dirty - atLaundry`.

5. **Daily transition** from day `D` to `D + 1`:
   - Linen of reservations whose `endDate == D + 1` (check-out next day): moves from
     `inCirculation` to `dirty`.
   - Linen of reservations whose `startDate == D + 1` (check-in next day): moves from
     `clean` to `inCirculation`.
   - If `D + 1` is the laundry day:
     - Drop-off = current `dirty` → moves to `atLaundry`. `dirty` resets to 0.
     - Pick-up = `atLaundry` from `D + 1 - 7` (i.e. the previous laundry day's drop-off)
       → moves to `clean`. The `atLaundry` bucket is sliced by drop-day (so we know when
       each batch returns).

6. **Order on the laundry day** (rule 8.bis from weekly spec):
   - The arrival's clean linen comes from BOTH the pre-laundry-day `clean` pile AND the
     pick-up of the same day (Adrien collects the laundry early enough to install fresh
     linen on incoming guests). Modelled as: pick-up runs BEFORE the check-in step.

### 3.3 Linen contract per reservation per type

7. Reuses the rules already pinned by `weekly-bed-linen-tracking.md`. **Narrowed 2026-08-11 by
   [laundry-counts-explicit-option-only.md](laundry-counts-explicit-option-only.md) §3.1** — the
   projection must apply the exact same contract rule as the laundry card, or the two disagree on
   which stays consume linen:
   - Bed-linen: count `singleBeds × linenIncludesSingle + doubleBeds × linenIncludesDouble
     + babyBeds × linenIncludesBaby` if a linen-flagged option is **on the reservation**. The
     property default is a source **only for internal options** (`displayToClient = 0`), which can
     never be on a reservation — this is what keeps « Tapis de bain » projected. A *visible*
     option that was not ticked contributes nothing (the former §3.7 union is reversed).
   - Bathroom-linen: per type = `ROUND(persons × Σ quantity × towel<Size>PerPerson)` where
     persons = `adults + teens + children` (babies excluded) and `Σ quantity` is the sum of
     `reservation_options.quantity` over bathroom-flagged options on the reservation. The `1.0`
     property-default quantity now applies to internal options only, same rule as above.
   - Devis (`kind = 'devis'`) excluded.

### 3.4 Horizon & detection

8. The simulation runs from `today` to `max(reservations.endDate)` (the last known
   reservation's check-out). Beyond that there's nothing to project — the page footer
   states the horizon date.

9. A **shortage** is declared for a (type, day) pair when at the end-of-day transition (after
   check-ins and the laundry-day cycle) `clean[type] < 0`. The missing quantity is
   `-clean[type]`.

10. **Impacted reservations** for a shortage on (type, day) = reservations whose `startDate`
    falls in the day(s) where `clean[type]` is negative AND whose linen contract for that
    type is > 0. Pinned by tests.

11. The simulation does NOT "borrow from the future" — once a type goes negative, it stays
    negative until the next pick-up brings sets back. The shortage report lists every day
    with a deficit, but the Dashboard aggregates them per type (next contract).

### 3.5 Display

12. **Planning — laundry card**: after the existing `À apporter` / `À récupérer` blocks, a
    **third line** `Disponible après ce dépôt :` listing each type with non-zero stock and
    the post-laundry-day `clean[type]` value. Format example:
    `Draps : 3 doubles, 5 simples, 1 bébé` then `Serviettes : 8 grandes, 4 petites`.
    A type with `< 0` is **rendered in red** and prefixed with `−` (e.g. `−2 doubles`). The
    label of the line stays the same; only the values switch colour. Mobile (xs): wraps
    naturally; the red highlight stays per chip.

13. **Dashboard — shortage alert**: when at least one shortage exists in the horizon, a red
    `<Alert severity="error">` at the top of the Dashboard, with:
    - Bold title `Stock blanchisserie insuffisant — N type(s) de linge en rupture à partir du
      DD/MM/YYYY` (**Updated 2026-06-12:** the date is the **earliest first-shortage date** across
      types — the actionable date — NOT the projection horizon. The horizon = last reservation's
      checkout is a meaningless upper bound for the operator: a single far-future booking pushes it
      months out, which read as a nonsensical date.)
    - One line per **type** in shortage (rule 11), self-contained so the linen type is unambiguous:
      `<Type> : jusqu'à N manquant(s) · première rupture le DD/MM/YYYY`, e.g.
      `Drap double : jusqu'à 2 manquants · première rupture le 13/06/2026`.
      - List of impacted reservations as clickable chips labelled
        `<client first name> <client last name>` (falls back to `#<reservation-id>` only
        when the client row was deleted). Clicking navigates to `/reservations/:id`.
    - No alert when no shortage exists in the horizon.

14. **Empty state**: a type with `totalStock = 0` is invisible in both displays
    (Planning card and Dashboard alert). Operationally: "I don't track this type" =
    "don't surface anything about it".

### 3.6 Re-computation triggers

15. The simulation runs **on demand**, server-side, for every `GET /api/planning/linen-inventory`
    and `GET /api/dashboard/linen-shortage` call. No persistent cache (yet — see rule 17).

16. The client triggers a fetch:
    - On Planning page load (already in the existing laundry-summary fetch — extend that
      endpoint OR add a parallel one).
    - On Dashboard page load.
    - After every successful reservation create / update / delete via the existing API
      (the client refreshes the relevant view on success).
    - After every successful option / settings save that touches a linen-related field.

17. **Caching is out of scope for V1.** The bounded data (≤ 365 days × ≤ ~50 active
    reservations per day = ~18 000 cell evaluations per call) keeps the simulation under
    100 ms in dev. If prod surfaces a latency issue, a memory cache with invalidation on
    reservation_options / app_settings / property_option_defaults writes is the next step
    (out of scope for this PR).

### 3.7 Edge cases (pinned by tests)

- **Stock = 0 for a type** → that type is never in shortage; never in the Planning numbers
  either. Avoids polluting the UI with a permanent shortage from an unconfigured type.
- **No reservations at all** → horizon = today, no shortages, no display lines (the cards
  themselves are still hidden by rule 13 of the weekly spec).
- **A reservation's checkout is on a laundry day** (window's right-inclusive boundary): the
  linen counts as "freshly dirty" → drops the same day → at-laundry next slot. Already
  matches rule 8 of the weekly spec.
- **Stock change mid-horizon**: not tracked. The simulation always uses the CURRENT stock
  values; a change today applies to the entire horizon from today onwards.
- **Negative number formatting**: `−` (U+2212, math minus sign) not the hyphen, so the
  red chip reads cleanly on retina screens.

---

## 4. Architecture

> Reminder — Fat backend, thin frontend.
> All simulation logic lives in `server/src/utils/linenInventory.js` (pure JavaScript). The
> client only renders the simulation result.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | 6 idempotent ALTER TABLE adding the stock columns to `app_settings`. |
| `models/settingsModel.js` | `settingsModel.js` | T | Adds the 6 stock columns to `COLUMNS` + their numeric defaults to `NUMERIC_DEFAULTS`. |
| `controllers/settingsController.js` | `settingsController.js` | T | New `LINEN_STOCK_FIELDS` group + handler in `updateSettings`. Validation: each value coerced to a non-negative integer (`Math.max(0, Math.floor(Number(...)))`). |
| `utils/settingsResponse.js` | `settingsResponse.js` | T | Adds the `linenStock` block to the response shape. |
| `utils/linenInventory.js` | `linenInventory.js` | C | **Core simulation engine.** Pure function `simulateInventory({ stock, reservations, options, propertyDefaults, laundryWeekday, from, to })` returns `{ days: [{ date, clean, inCirculation, dirty, atLaundry, shortages: [{ type, missing, impactedReservationIds }] }], shortagesByType: { single: { firstDate, maxMissing, impactedReservationIds }, ... } }`. No DB access — caller assembles the inputs. |
| `models/linenInventoryModel.js` | `linenInventoryModel.js` | C | Thin DB-access wrapper that gathers the inputs (reservations + options + defaults + settings) and delegates to `utils/linenInventory.js`. |
| `controllers/planningController.js` | `planningController.js` | T | New action `linenInventory(req, res)` — wraps the model + returns the per-day series. Reused by the Planning card. |
| `controllers/dashboardController.js` (new) | `dashboardController.js` | C | New thin controller with `linenShortage(req, res)` returning the grouped-by-type shortage payload. |
| `routes/planning.js` | `planning.js` | T | Adds `GET /api/planning/linen-inventory`. |
| `routes/dashboard.js` (new) | `dashboard.js` | C | Adds `GET /api/dashboard/linen-shortage`. Mounted under `/api/dashboard`. |
| `index.js` | `index.js` | T | Wires the new dashboard router. |
| `tests/` | `linen-inventory.unit.test.js` | C | Pure-function tests on the engine. ≥ 15 cases: conservation invariant on every day; multi-property aggregation; property-default fallback; per-type stock = 0 = silent; shortage detection + impacted reservations; arrivals on a laundry day come from same-day pick-up; bathroom qty sub-occupation factor honoured; devis excluded. |
| `tests/` | `linen-inventory-model.unit.test.js` | C | In-memory DB integration: model gathers inputs correctly + delegates. |
| `tests/` | `dashboard-controller-linen.unit.test.js` | C | Controller payload shape pinned. |
| `tests/` | `planning-controller-linen-inventory.unit.test.js` | C | Per-day Planning payload pinned. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T | Two new helpers: `getLinenInventory({ from, to })` + `getLinenShortageAlert()`. |
| `constants/sidebar.js` _(or wherever the routes table lives)_ | _existing_ | T | New sidebar entry **Stock blanchisserie** under Paramètres → route `/parametres/stock-blanchisserie`. |
| `App.js` | `App.js` | T | New `<Route path="/parametres/stock-blanchisserie" element={<LinenStockPage />} />`. |
| `pages/LinenStockPage.js` | `LinenStockPage.js` | C | Standalone page with 6 number fields, Save button, validation. Reads `linenStock` from `/api/settings` + writes via `PUT /api/settings { linenStock: {...} }`. Consistent with the existing SettingsPage section pattern + uses `PageActionBar`. |
| `components/LaundryDayCard.js` | `LaundryDayCard.js` | T | Adds the 3rd block `Disponible après ce dépôt :` with type rows; red colouring on negative values. Reads new props `inventoryAfter` (alongside existing `data`). |
| `pages/PlanningPage.js` | `PlanningPage.js` | T | Calls `api.getLinenInventory` alongside the existing laundry-summary fetch; threads the per-laundry-day inventory into `<LaundryDayCard inventoryAfter={…} />`. |
| `components/LinenShortageAlert.js` | `LinenShortageAlert.js` | C | Read-only Dashboard alert rendering the grouped-by-type list. Hidden when no shortage. |
| `pages/Dashboard.js` | `Dashboard.js` | T | Mounts `<LinenShortageAlert />` at the top. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar` (Save/Cancel on the new Settings sub-page), `Alert`, MUI `TextField`, `Chip`. | Standard reuse. |
| **Created (new generic)** | `LinenShortageAlert` could be a candidate if future features need a similar grouped-deficit alert. Kept feature-local for now; ready to extract. | |
| **Specific (kept feature-local)** | `LinenStockPage` (specific to the linen stock fields). | |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/planning/linen-inventory?from=YYYY-MM-DD&to=YYYY-MM-DD` | — | `{ horizon: 'YYYY-MM-DD', days: [{ date, byType: { single: { clean, inCirculation, dirty, atLaundry, shortageMissing }, ... } }] }` | One entry per **laundry day** in the range. The client picks the relevant entries to display under each Planning laundry card. |
| GET | `/api/dashboard/linen-shortage` | — | `{ horizon: 'YYYY-MM-DD', shortagesByType: [{ type, firstShortageDate, maxMissing, impactedReservations: [{ id, clientName, startDate, endDate }] }] }` | Empty `shortagesByType` array when no shortage. |

The `linenStock` block on `GET /api/settings` :
```jsonc
{
  "linenStock": {
    "bedSingle": 12,
    "bedDouble": 8,
    "bedBaby":   2,
    "towelLarge": 30,
    "towelMedium": 0,   // 0 = not tracked
    "towelSmall": 30
  }
}
```

`PUT /api/settings` accepts the same shape under `linenStock`. Validation: each value is a
non-negative integer ≤ 999. The 999 ceiling is arbitrary (Adrien's house keeps ~80 sets per
type max); 999 is plenty and avoids overflow noise.

---

## 5. Data model

### 5.1 New columns on `app_settings`

```sql
ALTER TABLE app_settings ADD COLUMN bedLinenStockSingle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN bedLinenStockDouble INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN bedLinenStockBaby   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN towelStockLarge     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN towelStockMedium    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN towelStockSmall     INTEGER NOT NULL DEFAULT 0;
```

All idempotent, wrapped in the existing `tryAddAppSettingsCol(...)` helper. Defaults all 0
which preserves the previous behaviour ("no stock tracked" = no display).

### 5.2 Data impact

Zero. Every existing row sees `0` as the default value. The simulation skips types with
stock = 0, so installs without stock data see no UI change.

---

## 6. UI / UX

### 6.1 New sub-page: `/parametres/stock-blanchisserie`

Sidebar entry under Paramètres, label **Stock blanchisserie**, icon `Inventory2Icon` (already
imported in the codebase). The page renders a `PageActionBar` at the top with title
*"Stock blanchisserie"* + Save/Cancel canonical actions. Body has two Cards:

```
┌────────────────────────────────────────────┐
│ 🛏️  Parures de lit                          │
│                                            │
│ [Simples : ___]  [Doubles : ___]  [Bébé : ___]│
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ 🛁  Serviettes                             │
│                                            │
│ [Grandes : ___]  [Moyennes : ___]  [Petites : ___]│
└────────────────────────────────────────────┘
```

Helper text under each card: *"Indiquez 0 si vous ne souhaitez pas suivre ce type."*

Save → `PUT /api/settings { linenStock: {...} }`. Dirty-form guard + green snackbar on
success, identical to the rest of SettingsPage's stack.

### 6.2 Planning — LaundryDayCard

Extended with a third block after `À récupérer`:

```
┌───────────────────────────────────────────────┐
│ 🧺  Linge à la blanchisserie                  │
│                                               │
│ À apporter     │ À récupérer     │            │
│ Draps : ...    │ Draps : ...     │            │
│ Serviettes :…  │ Serviettes :…   │            │
│                                               │
│ Disponible après ce dépôt :                  │
│ Draps : 3 doubles · 5 simples · −2 bébé       │  ← "−2 bébé" in red
│ Serviettes : 8 grandes · 4 petites            │
└───────────────────────────────────────────────┘
```

Mobile (xs): the third block stacks under the others; the value list wraps naturally.

### 6.3 Dashboard — LinenShortageAlert

Mounted at the top of the Dashboard, before the existing widgets. Hidden when no shortage.

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ Stock insuffisant — 3 ruptures prévues d'ici le 30/06    │
│                                                             │
│ Drap simple                                                 │
│ Première rupture le 12 juin · jusqu'à −4 manquants          │
│ Réservations impactées : [#123] [#127] [#129]               │
│                                                             │
│ Drap double                                                 │
│ Première rupture le 18 juin · jusqu'à −2 manquants          │
│ Réservations impactées : [#125]                             │
│                                                             │
│ Serviette grande                                            │
│ Première rupture le 12 juin · jusqu'à −8 manquantes         │
│ Réservations impactées : [#123] [#127]                      │
└─────────────────────────────────────────────────────────────┘
```

Chip clicks navigate to the reservation page (`/reservations/:id`).

### 6.4 Responsive behaviour

- Settings sub-page on `xs`: the two cards stack; the 3-input rows stack to 1 column.
- Settings sub-page **(reworked 2026-06-08)**: container widened to
  `maxWidth: { md: 900, lg: 1240 }` and the two cards (Parures de lit / Serviettes) sit
  **side-by-side on `lg+`** via a `columnCount: { xs: 1, lg: 2 }` masonry — consistent with
  the main Settings page; single column ≤ `md`.
- Laundry card on `xs`: third block stacks under "À récupérer".
- Dashboard alert on `xs`: per-type sections stack; chips wrap; touch targets ≥ 44px.

---

## 7. Test plan

### 7.1 Server unit tests

- [ ] `linen-inventory.unit.test.js` — ≥ 15 cases on the pure engine:
  - Conservation invariant (clean + inCirculation + dirty + atLaundry = totalStock) on every
    day of every test scenario.
  - Stock = 0 for a type → simulation skips that type, no shortage ever raised.
  - Single property + 1 reservation + 1 laundry day → expected values.
  - Multi-property aggregation (global stock across 2 properties).
  - Property-default fallback contributes to in-circulation even without explicit option row.
  - Pick-up on laundry day D = drop-off of D − 7 days.
  - Arrivals on a laundry day are served by same-day pick-up (rule 6 ordering).
  - Bathroom qty sub-occupation factor 0.6667 honoured.
  - Devis-stage reservations excluded.
  - Shortage detection: clean < 0 → flagged + missing quantity = `-clean`.
  - Impacted reservations: only those with arrivals on shortage day(s) AND contract > 0 for
    the shortage type.
- [ ] `linen-inventory-model.unit.test.js` — model gathers inputs correctly + delegates.
- [ ] `planning-controller-linen-inventory.unit.test.js` — controller payload shape pinned.
- [ ] `dashboard-controller-linen.unit.test.js` — alert payload pinned.

### 7.2 Manual UI verification

- [ ] Set all 6 stock values in the new sub-page → save → re-open: values persist.
- [ ] Stock = 0 for "Serviettes moyennes" → that type doesn't appear in any UI.
- [ ] Create reservations that exceed bed-single stock on a future date → Dashboard alert
      appears with the correct date, missing count, impacted reservation chip.
- [ ] Click an impacted reservation chip → navigates to `/reservations/:id`.
- [ ] Modify a reservation to reduce demand below stock → next page reload, alert disappears.
- [ ] Activate property default for Linge de lit on Property X → pre-feature reservations of
      X now contribute → numbers shift in the Planning card AND alerts surface if relevant.
- [ ] Mobile (xs): every screen renders without overflow.

---

## 8. Out of scope

- **Stock change history** (audit log): not stored. Only the current snapshot.
- **Cache + invalidation**: see rule 17 — opt-in if prod surfaces latency.
- **Email notification of upcoming shortages**: deferred. Dashboard alert is the V1 surface.
- **Per-property stock breakdown**: explicitly excluded (Adrien wants global only).
- **Buying suggestions** ("buy 4 doubles before June 12"): out of scope; the user reads the
  shortage and acts.
- **Past shortages** (historical analysis): not surfaced. The simulation starts at "today".
- **Editable horizon**: the horizon is the last reservation's endDate; no UI control.
- **Concurrent stock between owners**: out of scope (single-tenant app).

---

## 9. Open questions

_(Resolved before moving Status → Approved.)_

- Q: Should the Settings sub-page show a "Dernier inventaire effectué le DD/MM" timestamp?
  - A (proposed): No, V1 is "just the numbers". Audit log = future.
- Q: Should the Dashboard alert ALSO surface as a notification bell / count badge?
  - A (proposed): No, V1 is alert-only on the Dashboard.
- Q: Should the Planning card's third block be visually distinct (e.g. background tint)?
  - A (proposed): No — it stays inside the same cyan LaundryDayCard. The red colouring of
    individual values is enough to draw the eye.
