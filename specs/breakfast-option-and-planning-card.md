# Breakfast option + planning card

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/breakfast-option-and-planning-card` _(user-managed)_ |
| **Created** | 2026-06-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

`Linge de lit` and `Linge de toilette` are today the only two
"typed default" options of GuestFlow. Both are seeded on every fresh
install via dedicated functions
([server/src/utils/bedLinenSeed.js:27-117](server/src/utils/bedLinenSeed.js#L27-L117)
+ [server/src/utils/bathroomLinenSeed.js:18-92](server/src/utils/bathroomLinenSeed.js#L18-L92))
called from [database.js:1652-1658](server/src/database.js#L1652-L1658).
They carry an `autoOptionType` marker (`bed_linen` /
`bathroom_linen`) that the operator can never delete (it's the canonical
hook the rest of the codebase looks for), and they surface on the
Planning page as the `LaundryDayCard` block on every laundry Tuesday.

**Petit déjeuner** is a frequent service for B&B-style properties
(Adrien's Gîte). Today it is **NOT** seeded — every installation must
add it manually — and it has **NO** planning surface, so the operator
has to mentally cross-reference "who's here this morning + who has the
breakfast option" every morning. The risk: a missed breakfast on a
reservation that paid for it.

## 2. Goal

Petit déjeuner becomes a seeded typed-default option (same family as
the two linen options), and on the Planning page a **BreakfastDayCard**
shows up on every date a customer holding the breakfast option is
present in the morning, with the per-reservation breakdown + a total
of breakfasts to prepare.

## 3. Functional rules

1. **Seed** — on every boot, ensure exactly one row in `options` with
   `autoOptionType = 'breakfast'`. Same promotion + insert pattern as
   the linen seeds (any existing row matching the known title aliases
   gets promoted; otherwise a fresh row is inserted). Catalog row's
   defaults: `priceType = 'per_person_per_night'`, `price = 0`
   (operator sets price after install), `autoEnabled = 0` (manual
   per-reservation opt-in), `countsAsBedLinen = 0`,
   `countsAsBathroomLinen = 0`.
2. **Discriminator** — the canonical hook is
   `options.autoOptionType = 'breakfast'`. No new column on `options`.
   Reusing the existing `autoOptionType` mirror what bed-linen and
   bathroom-linen do at the same layer.
3. **Reservation eligibility** — a reservation contributes to a
   breakfast date if **both**:
   a. it has a row in `reservation_options` linking to an option with
      `autoOptionType = 'breakfast'` AND `quantity > 0`, OR a
      property-default row in `property_option_defaults` points at
      such an option (same UNION ALL fallback pattern as the laundry
      aggregator);
   b. it is "present in the morning of date D" (rule 4).
4. **"Present in the morning of D"** — `startDate < D AND endDate >= D`.
   Customer arrived the afternoon of `startDate`, slept the night
   `D-1 → D`, eats breakfast on `D`. The morning of `startDate` is
   excluded (the customer hasn't arrived yet); the morning of `endDate`
   is included (the customer slept the night before and is still here
   for breakfast). This is the half-open `(startDate, endDate]` window
   matching the user's choice 2026-06-05.
5. **Breakfast count per reservation** — `ROUND((adults + teens +
   children) × COALESCE(reservation_options.quantity, 1))`. Babies
   excluded (same convention as the bathroom-linen aggregator). The
   `quantity` multiplier follows Adrien's sub-occupation pattern (e.g.
   `0.6667` = 2 of 3 want breakfast). When the contribution comes from
   a property default fallback, `quantity = 1.0` (the whole eligible
   party gets breakfast).
6. **Per-day card content** — the `BreakfastDayCard` on date D shows:
   - Title `Petit déjeuner` with a `BreakfastDining` icon.
   - One row per contributing reservation, format
     `Nom du client (Logement) : N pers.` where `N` = the count from
     rule 5.
   - A divider + a `Total` line `Total : N petits déjeuners`.
7. **Hide-when-empty** — when zero reservations contribute on a day,
   the card is not rendered (same rule-13 pattern as
   `LaundryDayCard`). The server still emits zero-everywhere days for
   contract uniformity; the client filters.
8. **Day-set inclusion** — a date that has a breakfast card but no
   arrival / departure / resource booking / laundry on it MUST still
   appear in the planning's day list. Extend the existing
   merged-date-set in
   [PlanningPage.js:830-843](client/src/pages/PlanningPage.js#L830-L843)
   to include `Object.keys(breakfastByDate).filter(non-empty)`.
9. **No skip mechanism** — unlike laundry, breakfast doesn't get a
   skip toggle. If the operator didn't serve a breakfast, that's an
   operational fact, not a data invariant — and no downstream
   simulation depends on breakfast being served. Out of scope.

**Edge cases:**

- **Multiple breakfast-flagged options in the catalog** (extremely
  rare). Each contributes independently per the same UNION ALL
  fallback as bed-linen. The card sums them all.
- **A reservation that crosses a month boundary** — date math is pure
  ISO, no DST surprise (mirrors `laundryWindow.js` utilities).
- **A devis** (`kind = 'devis'`) — never contributes. The aggregator's
  `WHERE r.kind = 'reservation'` clause keeps devis out.
- **Property default for breakfast** — same fallback as laundry: a
  reservation on a property whose `property_option_defaults` includes
  the breakfast option counts even when no explicit
  `reservation_options` row exists, with `quantity = 1.0`.
- **A reservation without `quantity`** (legacy iCal import without an
  options selection) — `COALESCE(quantity, 0) = 0` on the explicit-
  options path; the property-default path injects `quantity = 1.0`
  when the property declares the option as a default. Otherwise the
  reservation contributes 0 to breakfast.

---

## 4. Architecture

> **Fat backend, thin frontend.** Every per-day aggregation lives on
> the server (single SQL pass over the window). The client just maps
> `breakfastByDate[date]` to a JSX card. The "present in the morning"
> rule + the rounding live in the SQL, not in the React component.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/breakfastSeed.js` | C | NEW — mirrors `bedLinenSeed.js`: `ensureDefaultBreakfastOption(db)` that promotes any matching existing row + inserts a fresh row when no `autoOptionType = 'breakfast'` exists. |
| `database.js` | `database.js` | T | One-line require + call right after the existing `ensureDefaultBathroomLinenOption(db)` block ([database.js:1656-1658](server/src/database.js#L1656-L1658)). |
| `models/` | `models/breakfastModel.js` | C | NEW — factory `buildModel(db)` exposes `breakfastByDate({ from, to }) → { [iso]: [{ reservationId, clientName, propertyName, persons }, ...] }`. Single SQL query with the `(startDate, endDate]` filter + the UNION ALL pattern for explicit option vs. property default. Mirrors `laundryModel.js`. |
| `controllers/` | `controllers/planningController.js` | T | NEW action `breakfastSummary(req, res)` exposing the model output as a flat JSON payload. Inputs validation reuses the `isIsoDate` helper already at the top of the file. |
| `routes/` | `routes/planning.js` | T | NEW route `GET /planning/breakfast` → `controller.breakfastSummary`. |
| `tests/` | `tests/breakfast-seed.unit.test.js` | C | 4 cases (see §7). |
| `tests/` | `tests/breakfast-model.unit.test.js` | C | 6 cases (see §7). |
| `tests/` | `tests/planning-breakfast-controller.unit.test.js` | C | 4 cases (see §7). |

**Reuse:**
- The laundry aggregator's UNION ALL pattern
  ([laundryModel.js:41-84](server/src/models/laundryModel.js#L41-L84))
  is the exact template for the breakfast model. Just swap the
  `countsAsBedLinen = 1` filter for `autoOptionType = 'breakfast'`
  and change the WHERE date logic.
- The `isIsoDate(value)` helper already at the top of
  `planningController.js` covers the from/to validation.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/BreakfastDayCard.js` | C | NEW — pure renderer. Props: `data: { items: [{ reservationId, clientName, propertyName, persons }], totalPersons }`. Returns `null` when `items.length === 0`. |
| `pages/` | `pages/PlanningPage.js` | T | (1) New state `breakfastByDate: { [iso]: { items, totalPersons } }`. (2) In the `loadPlanning` `Promise.all` (after the existing laundry/inventory calls), add `api.getBreakfastPlanningSummary({ from, to })`. Same incremental-loading wiring in the infinite-scroll handler. (3) Extend the merged date-set ([PlanningPage.js:830-843](client/src/pages/PlanningPage.js#L830-L843)) with `Object.keys(breakfastByDate).filter(d => breakfastByDate[d].totalPersons > 0)`. (4) Mount `<BreakfastDayCard data={breakfastByDate[date]} />` in the day-cell render block, right after the `<LaundryDayCard>` and before the departures block. |
| `api.js` | `api.js` | T | NEW: `getBreakfastPlanningSummary({ from, to })`. Same shape as `getLaundryPlanningSummary`. |
| `tests/` | `client/src/components/__tests__/BreakfastDayCard.test.js` | C | 4 Vitest cases (see §7). |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Card`, `CardContent`, `Box`, `Typography`, `Stack`, `Divider` (MUI). `BreakfastDining` (MUI icon). | All pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `BreakfastDayCard` (new). Specific to the breakfast feature; same scope as `LaundryDayCard`. |

### 4.3 API contract

| Method | Endpoint | Request body / query | Response | Notes |
|---|---|---|---|---|
| GET | `/api/planning/breakfast?from=YYYY-MM-DD&to=YYYY-MM-DD` | — | `{ breakfastByDate: { 'YYYY-MM-DD': { items: [{ reservationId, clientName, propertyName, persons }], totalPersons } } }` | Auth-only. Empty payload when no reservations match. |

Error shape: `{ error: 'INVALID_DATE_RANGE' }` with status 400 on
malformed `from` / `to` (mirrors `laundrySummary`).

---

## 5. Data model

No schema change. The breakfast option lives in `options`,
identified by `autoOptionType = 'breakfast'`. The promotion path in
the seed catches any pre-existing row named "Petit déjeuner" /
"Petit-déjeuner" so existing installations gain the marker without a
duplicate.

**Data impact:** none for existing data. Fresh installs get one new
row in `options`. Existing operator-created breakfast options
(matching the title aliases) get the `autoOptionType = 'breakfast'`
marker added so the planning aggregator finds them.

---

## 6. UI / UX

### Card visual

```
🥐 Petit déjeuner
─────────────────────────────────
Famille Dupont (Gîte)   : 4 pers.
M. Martin    (Studio)   : 2 pers.
─────────────────────────────────
Total : 6 petits déjeuners
```

- Background: warm amber (`amber[50]` or similar), distinct from the
  cyan laundry card so the operator can scan at a glance.
- Icon: MUI `BreakfastDiningIcon` (croissant).
- Each row: `<Typography variant="body2">`. The total line: bold.

### Copy (French strings)

- Card title: `Petit déjeuner`
- Per-row: `{clientName} ({propertyName}) : {N} pers.`
- Total: `Total : {N} petits déjeuner{s if >1}`

### Responsive behavior

- `xs` (≤600px): rows stack naturally (each `Typography` block is
  already block-level); no horizontal scroll. Card padding reduced.
- `md+`: rows render in a single column with comfortable line-height.

### Placement on PlanningPage

The breakfast card sits **right after** the `LaundryDayCard` and
**before** the departures block. Operator's morning workflow: see
laundry batch → see breakfasts to prepare → see who's leaving today.

### Empty / loading

- No matching reservations on a date → no card rendered. The date
  itself still shows if it has any other planning event (arrival,
  departure, laundry, resource booking).
- Network failure on the breakfast fetch → silent fallback to an
  empty map (mirrors the laundry fetch error handling). The rest of
  the planning still loads.

---

## 7. Test plan

### 7.1 Server unit tests

| File | Cases |
|---|---|
| **NEW** `tests/breakfast-seed.unit.test.js` | (1) Fresh DB → seed inserts one row with the right columns. (2) Existing matching-title row (no autoOptionType) → promoted, no insert. (3) Existing row already typed → skip, no duplicate. (4) Two boots in a row → idempotent (count stays at 1). |
| **NEW** `tests/breakfast-model.unit.test.js` | (1) Reservation with explicit breakfast option, 2 adults + 1 child → date `(startDate, endDate]` window contains 3 persons per morning. (2) `startDate` morning is excluded; `endDate` morning is included. (3) Babies are excluded from the count. (4) `quantity = 0.6667` sub-occupation factor → count rounds correctly. (5) Property default fallback contributes when no explicit option row. (6) Devis (kind='devis') excluded. |
| **NEW** `tests/planning-breakfast-controller.unit.test.js` | (1) Validates from/to ISO format, 400 on malformed. (2) Empty response when no reservations match. (3) Payload shape pinned: `{ breakfastByDate: { ... } }`. (4) `from > to` → 400. |

Expected: existing **~1033** + **4 + 6 + 4** = **~1047** server tests.

### 7.2 Client unit tests (Vitest)

| File | Cases |
|---|---|
| **NEW** `client/src/components/__tests__/BreakfastDayCard.test.js` | (1) `items: []` → renders `null`. (2) 2-item card → shows both rows + total. (3) Total is correctly summed. (4) `data: undefined` → renders `null` (defensive). |

Expected: existing **237** + **4** = **241** Vitest cases.

### 7.3 Manual UI verification

- [ ] Boot dev server on a fresh DB → confirm `Petit déjeuner` exists
      in `/options` (Settings) with the typed marker.
- [ ] Open an existing reservation, enable Petit déjeuner with the
      catalog quantity, save → reload Planning, confirm the
      breakfast card appears on the expected dates `(startDate,
      endDate]` with the right person count.
- [ ] Disable the option, save → card disappears.
- [ ] On a property with breakfast as a default, a reservation
      without an explicit row → card still appears.
- [ ] Mobile breakpoint (`xs`) → card stacks readably.

---

## 8. Out of scope

- **Breakfast skip toggle.** Unlike laundry trips, breakfasts don't
  feed a downstream simulation. If the operator didn't serve one,
  that's an operational fact, not a data invariant.
- **Per-property breakfast aggregation alert** (e.g. a "you'll run
  out of croissants on June 12" Dashboard banner). Future iteration.
- **Breakfast pricing tiers / progressive pricing.** The seeded
  option is `per_person_per_night` flat. Operators who need tiered
  pricing can clone the option and configure it manually.
- **Server-side enforcement that bed/bath/breakfast options can't
  share `autoOptionType` values.** UNIQUE constraint would be ideal
  but it's a follow-up — current seeds guard at the application
  layer (`hasTypedSeed` check).

---

## 9. Open questions

(All resolved before moving Status to Approved.)

1. ✅ **Person count basis** → `adults + teens + children` (babies
   excluded), matching bathroom-linen.
2. ✅ **Card layout** → one aggregated card per day with per-
   reservation breakdown + total.
3. ✅ **Day range** → half-open `(startDate, endDate]` (= breakfast
   served from the morning after arrival to the morning of departure
   inclusive).

---

## 10. Implementation progress

_(Filled in as commits land. Update this section in the same commit
that ships each step, per CLAUDE.md §4.1.)_

- [ ] Server: `breakfastSeed.js` + wiring in `database.js` + tests.
- [ ] Server: `breakfastModel.js` + tests.
- [ ] Server: `planningController.breakfastSummary` + route + tests.
- [ ] Client: `api.getBreakfastPlanningSummary` + state in
      `PlanningPage` + day-set inclusion + card mount.
- [ ] Client: `BreakfastDayCard` + Vitest.
- [ ] Manual UI verification.
- [ ] Docs: spec status → Implemented, CHANGELOG entry.
