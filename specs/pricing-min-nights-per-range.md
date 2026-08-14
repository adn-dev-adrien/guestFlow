# Per-range minimum nights + calendar season painting

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/pricing-min-nights-per-range` _(user-managed)_ |
| **Created** | 2026-08-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Property pricing is organised into **tariff seasons** (`pricing_rules`, one row per season) on the
**Gestion tarifaire** page (`client/src/pages/PropertyPricingSeasonsPage.js`, route
`/properties/:id/pricing-seasons`). Each season carries a colour, a net `pricePerNight`, a pricing
mode (fixed / progressive), one or more **date ranges** (`dateRanges` JSON = `[{startDate, endDate}]`)
and — already today — a **season-level `minNights`** (`pricing_rules.minNights`, default 1).

That minimum is already **enforced end-to-end**: the pricing engine
(`server/src/utils/pricing.js` → `calculateBaseStayPrice`) computes `requiredMinNights` as the **max
of the `minNights` of every season a stay touches`, and both the admin reservation flow
(`reservationsController` create/update) and the public booking flow (`publicBookingRequestController`)
reject a too-short stay with `409 MIN_NIGHTS` (admins can override with `forceMinNights`).

**What is missing.** The minimum is granular **per season only**. To require e.g. **3 nights on the
May "pont" (long weekend)** without changing the price or the min of the rest of the month, the owner
would have to carve a dedicated season out of the surrounding one (seasons cannot overlap —
`findPricingRuleOverlap`), duplicate its price, and manage the split by hand. There is also **no way
to select dates directly on the season calendar** to attach such a constraint — the multi-month grid
on the tarif page is read-only (clicking a coloured day only opens that season for edit).

**Concrete driver (owner's words).** Around a public holiday that falls on a Friday, a guest should be
able to book Thursday night → Sunday morning (3 nights) but **not** Friday night → Sunday morning
(2 nights). The 3-night floor must apply **only to that pont**, not to the whole season.

**Related specs (kept in sync — CLAUDE.md §4.1).** There is no dedicated "tariff seasons" spec today;
this one owns the seasons/pont behaviour. On implementation, two adjacent *Implemented* specs get a
back-reference: `pricing-engine-thin-client.md` (its min-nights resolution is now **per range**, not
per season) and `platform-price-from-commission.md` (the tarif page it documents now also hosts
season painting + per-range minimums).

## 2. Goal

From the Gestion tarifaire calendar, let the owner **select a period and (re)assign it to a season** —
an existing one or a brand-new one — **splitting the covering season in two when the selection sits
inside it** — and **attach a minimum number of nights** to that period. Per-range minimums, and the
dates that carry them, are **clearly visible in the seasons list**. The driving purpose is to block
short "grab the pont" reservations while still allowing the intended longer stay, without disturbing
the price or the minimum of the rest of the season.

## 3. Functional rules

1. A season's date range may carry its **own optional `minNights`** (`dateRanges` entries become
   `{startDate, endDate, minNights?}`). A per-range value is stored **only when it overrides the
   season default**; when absent, the range **inherits the season-level `minNights`** — itself
   defaulting to 1. An empty min field therefore means **"use the season's minimum"**, never a
   forced 1.
2. The **effective minimum for a night** = `range.minNights` if the covering range defines one, else
   the season's `minNights`, else `1`.
3. `requiredMinNights` for a stay = the **maximum effective minimum across the nights the stay
   actually touches** (a stay touches its arrival night through the night before departure). A stay
   is rejected (`minNightsBreached`) when `nights < requiredMinNights`. Enforcement points are
   unchanged (admin create/update `409 MIN_NIGHTS` with `forceMinNights` override; public booking
   `409 MIN_NIGHTS`).
4. **Pont example (rule 3 in practice).** Season "Mai" covers 2026-05-01…31 with `minNights=1`; a
   range 2026-05-08…09 inside it carries `minNights=3`. Then: Fri 05-08 → Sun 05-10 (nights of 08,09 =
   2) → `requiredMinNights=3` → **refused**; Thu 05-07 → Sun 05-10 (nights 07,08,09 = 3) →
   `requiredMinNights=3` → **allowed**; Mon 05-04 → Wed 05-06 (nights 04,05 = 2, does not touch the
   pont) → `requiredMinNights=1` → **allowed**.
5. On the Gestion tarifaire calendar, the owner can **select a contiguous period** (drag on desktop,
   or a "Affecter une période" button + date pickers everywhere) and open an **Assign dialog** to
   **(re)assign that period to a season**:
   a. **an existing season** — the one that already covers it (to only change the minimum, price
      unchanged) **or another season**; or
   b. **a new season** created from the period (name, colour, price, mode);
   and set the **minimum nights for that period** in the same dialog. When the period lies inside
   another season, that season is **split around it** (see rule 6) and the period moves to the target.
6. Assigning a period is a **server-side operation** (fat backend), atomic. The period is **carved out
   of every season range it overlaps**: a range fully containing the period is **cut into the two
   surrounding sub-ranges, both kept on the same season** (the season now has a gap), and each leftover
   part keeps its own `minNights`. The period is then attached to the **target** season as a range
   carrying the chosen `minNights`. A season left with **zero ranges** by the carve is **deleted** (all
   its dates were moved). Within a season, overlapping/adjacent ranges sharing the same `minNights` are
   merged, and each season's `startDate`/`endDate` bounds are recomputed.
7. A season's `minNights` (season default) remains editable per-range in the **season edit dialog**:
   each date-range row gets an optional "Min nuits" field (blank = inherit the season default).
8. The season **list/table** makes per-range minimums **first-class and visible**: every date range is
   listed with its own minimum — a small `min N` chip appears next to any range that overrides the
   season default — so the owner sees at a glance which dates carry a minimum. The season-level
   `minNights` stays in its column as the default. The **calendar** also marks days whose effective
   minimum exceeds the season default with a small badge + tooltip ("min 3 nuits").
9. Copying seasons to another property (`applyPricingTo`) carries **per-range `minNights`** across
   unchanged (it already round-trips `dateRanges`).

**Edge cases:**
- Selection spans **several seasons** → carve applies to each; the chosen `minNights` is attached to
  the target season only, over the whole selection (dates from other seasons are moved into the
  target). The dialog warns which seasons lose dates / get deleted.
- Selection covers **uncovered dates** (no season) → allowed only when the target is "new season" or
  an explicit existing season; the newly attached range simply covers those dates too.
- `minNights` input < 1, non-integer, or `startDate > endDate`, or bad ISO → `400`, no write.
- `range.minNights` **below** the season default is allowed (a range may lower its own floor); rule 2
  still resolves to the range value for that range's nights.
- **Catch-all seasons** (a legacy row with empty `dateRanges` that matches every date) are **not a
  supported paint target** and are left untouched by the carve — the app only ever creates
  explicit-range seasons (`create` seeds a full-year *range*), so this is a legacy-data edge only.
- Zero-night quote (same-day) → `requiredMinNights=1`, not breached (unchanged).

---

## 4. Architecture

> **Fat backend, thin frontend.** All the date-range algebra (carve / split / merge / bounds) and the
> minimum-nights resolution live on the server. The client only sends the selection + choice and
> re-renders the server payload. The single client-side derivation is a **display-only**
> `getMinNightsForDate` used to badge calendar days — it mirrors the existing display-only
> `getSeasonForDate` (colouring) and never gates a booking; the authoritative check stays in the
> engine + the `409 MIN_NIGHTS` guards.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | `normalizeDateRanges` preserves per-range `minNights`; `calculateBaseStayPrice` resolves the effective min **per matched range** (not per rule label) and keeps the max over touched nights. |
| `models/` | `propertiesModel.js` | T | New `assignDateRangeToSeason(propertyId, body)` — carve/split/merge/attach/delete-empty/recompute-bounds in a transaction. Existing `addPricingRule`/`updatePricingRule`/`applyPricingTo` gain per-range min for free via `normalizeDateRanges`. |
| `controllers/` | `propertiesController.js` | T | Thin `assignPricingDateRange` handler → `respond()`. |
| `routes/` | `properties.js` | T | `POST /:id/pricing/assign-dates`. |
| `middleware/` | — | — | (none) |
| `database.js` | — | — | **No migration** — per-range min lives in the existing `dateRanges` JSON; `pricing_rules.minNights` already exists. |
| `tests/` | `pricing-min-nights-per-range.unit.test.js` | C | Engine: per-range override, max-over-touched-nights, pont example, backward-compat, output shapes. |
| `tests/` | `properties-model-assign-date-range.unit.test.js` | C | Carve leftovers (0/1/2 parts) with min preserved, empty-season deletion, new-season creation, adjacent-equal-min merge, bounds, validation errors. |

**Notes.** `assignDateRangeToSeason` reuses `addDaysToIsoDate`, `normalizeDateRanges`,
`getBoundsFromDateRanges`, `parseRuleDateRanges`, `findPricingRuleOverlap`. Carve helper is a pure
function (unit-testable) operating on `[{startDate,endDate,minNights?}]`.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PropertyPricingSeasonsPage.js` | T | Per-range "Min nuits" field in the season dialog; calendar drag-select + selection highlight; new Assign dialog (reassign period to season + split + min); day min-nights badge; per-range `min N` chip in the table; "Affecter une période" action. |
| `api.js` | `api.js` | T | `assignPricingDateRange(propId, data)` → `POST /properties/:id/pricing/assign-dates`. |
| `components/` | — | — | Reuse `FormDialog`, `PageActionBar`, `ConfirmDialog`, `TableCard`, `EmptyState`; MUI `DatePicker`. No new generic component (the calendar grid is feature-specific to this page). |
| `hooks/` `services/` `utils/` `constants/` `styles/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `PageActionBar`, `ConfirmDialog`, `TableCard`, `EmptyState`, `ErrorAlert`, MUI `DatePicker` | All pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | the season month-grid + Assign dialog | Bound to the pricing-season data model of this one page; not reused elsewhere. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/properties/:id/pricing/assign-dates` | `{ startDate, endDate, minNights, target: { mode:'existing', ruleId } \| { mode:'new', label, color, pricePerNight, pricingMode } }` | `{ ok:true, deletedLabels:[...], createdRuleId? }` | Auth: admin (same as other `pricing` mutations). Errors: `400` invalid input; `404` unknown target `ruleId`. Atomic. |
| POST/PUT | `/api/properties/:id/pricing[/:ruleId]` | …existing… + `dateRanges:[{startDate,endDate,minNights?}]` | …unchanged… | `minNights` on a range persists when a finite int ≥ 1; blank omits it. |

The reservation-quote outputs (`requiredMinNights`, `minNightsBreached`, `minNightsRules`) keep their
shapes; only their **values** get finer. No public-API contract change.

---

## 5. Data model

- **No schema change, no migration.** `dateRanges` (TEXT JSON on `pricing_rules`) entries gain an
  optional `minNights` integer: `[{ "startDate":"2026-05-08", "endDate":"2026-05-09", "minNights":3 }]`.
  `pricing_rules.minNights` (season default) is unchanged.
- **Backfill:** none. Existing rows have ranges without `minNights` → they inherit the season default →
  **identical behaviour to today**.
- **Data impact:** none destructive. The Assign endpoint rewrites `dateRanges`/bounds of the affected
  seasons and may delete a season emptied by a carve — always as an explicit user action, in a
  transaction.

## 6. UI / UX

**Page order** (top → bottom): **calendar (multi-month grid)** → recipe card → season table → « Prix
plateformes ». The calendar is what the owner reads first — it is the visual answer to "what is
configured on which dates" — so it sits directly under the `PageActionBar`; the recipe and the season
table are the *editing* surfaces below it.

**Season edit dialog** (`FormDialog`, existing). Each date-range row gains a compact **"Min nuits"**
number input (min 1) after the two date pickers; empty = inherit the season default shown below. On
`xs` the row stacks (dates then min then delete). Season-level "Min nuits" field stays.

**Season table.** "Min nuits" column = season default. In the "Dates" column, **each range is shown
with its effective minimum**: a small MUI `Chip` `min N` appears next to any range that overrides the
season default (e.g. `08/05/2026 → 09/05/2026` + chip `min 3`), so ranges carrying a constraint are
spotted immediately. Ranges without an override render as today.

**Calendar (multi-month grid).**
- **Desktop:** press-drag across days selects a contiguous range (highlighted outline); releasing
  opens the Assign dialog with the range pre-filled. Clicking a single coloured day keeps its current
  "open season for edit" behaviour (a drag is distinguished from a click).
- **Everywhere / mobile:** a **"Affecter une période"** action (in `PageActionBar` `actionsBefore`)
  opens the Assign dialog with empty, manually-editable date pickers — no drag needed.
- Days whose **effective min > season default** show a small badge (the number, e.g. `3`) in a corner;
  tooltip appends "· min 3 nuits".

**Assign dialog** (`FormDialog`, fullScreen on `xs`). Title "Affecter une période à une saison".
Contents:
- Two `DatePicker`s (Début / Fin), pre-filled from the selection, editable.
- Target chooser (radio):
  - "Rattacher à la saison « X »" (auto-selected when the period is covered by exactly one season) —
    *le tarif ne change pas ; utile pour seulement poser un minimum*;
  - "Rattacher à une autre saison" → season dropdown — *la saison « X » sera coupée autour de la
    période*;
  - "Créer une nouvelle saison" → name + colour + `Tarif base (1 nuit)` + Fixe/Dégressif — *idem,
    coupe la saison couvrante*.
- **"Nuits minimum sur cette période"** number (min 1), defaulting to the covering/target season's
  current min (so a pure season change without touching the minimum is possible).
- Info `Alert` describing the split ("La saison « X » sera coupée autour de cette période.") and, when
  applicable, that an emptied season will be deleted.
- Copy: submit "Appliquer"; success toast — season change: `Période du 08/05/2026 au 09/05/2026
  affectée à « Pont mai ».`; min set: `Minimum de 3 nuits appliqué du 08/05/2026 au 09/05/2026.`; and,
  if any, `Saison « … » supprimée (dates réattribuées).`

**States.** Loading/error unchanged (`LoadingState`/`ErrorAlert`). Empty selection disables submit.
Server `400/404` shown inline in the dialog.

**Responsive.** `xs`: dialogs fullScreen, dialog fields stack, calendar entry via the button (no
drag); `md`: grid 3 months/row, drag works; `lg`: grid 4 months/row. No horizontal page scroll.

**PageActionBar.** Title `Gestion tarifaire - <name>`, `backTo` `/properties/:id`; `actionsBefore`:
existing "Appliquer à un autre logement" + "Nouvelle saison", **plus** new "Affecter une période"; on
`xs` extras collapse into the overflow menu (canonical actions stay visible).

## 7. Test plan

### Server unit tests
- [ ] `pricing-min-nights-per-range.unit.test.js` — rule 2 (range override beats season default),
      rule 3 (max over **touched** nights only), rule 4 (pont: 2-night refused, 3-night ok, off-pont
      ok), backward-compat (no per-range min ⇒ season min), `requiredMinNights`/`minNightsBreached`/
      `minNightsRules` shapes preserved, zero-night edge.
- [ ] `properties-model-assign-date-range.unit.test.js` — carve into 0/1/2 leftovers with per-range
      min preserved; attach to same/other/new season; empty-season deletion; adjacent-equal-min merge;
      bounds recompute; `400` (min<1, start>end, bad ISO) and `404` (unknown ruleId).

### Manual UI verification (`npm run dev`)
- [ ] Season dialog: add `min 3` on a range, save, reload → table shows the `min 3` chip on that range
      + calendar badge present.
- [ ] Calendar drag-select a May pont → assign to covering season, min 3 → on ReservationPage a
      Fri→Sun (2 n) booking returns `MIN_NIGHTS`, a Thu→Sun (3 n) passes; an off-pont 2-night stay in
      the same month passes.
- [ ] Select dates **in the middle** of an existing season → "Créer une nouvelle saison" (or another
      season) → covering season is **split into two ranges** (visible gap in the table), the period
      lands on the target season, bounds correct.
- [ ] Seasons list clearly shows, per range, the dates and their `min N` chip.
- [ ] Mobile (`xs`): use "Définir un minimum sur une période" + date pickers (no drag).
- [ ] Regression: season CRUD, cross-season overlap validation, apply-to-another-property (min carried
      over), progressive pricing preview, `PlatformPriceCard` grid, public quote min-nights.

## 8. Out of scope

- Per-range **price** overrides (a range only overrides *minimum nights*; price stays per-season — use
  a dedicated season for a different price).
- Any new **public-site** UI (min-nights is already enforced/surfaced publicly server-side).
- **Maximum**-nights, gap-fill, or check-in-day (arrival-day) restrictions — minimum only.
- Painting onto **catch-all** (empty-range) legacy seasons.
- Migrating the tarif page to a shared calendar component (the grid stays page-local).

## 9. Open questions

- Q: When a paint selection would delete an emptied season, block with a `ConfirmDialog` or just
  proceed + toast? — A: proceed + toast (non-modal); the info `Alert` in the dialog pre-warns. Revisit
  if it feels too silent in testing.
