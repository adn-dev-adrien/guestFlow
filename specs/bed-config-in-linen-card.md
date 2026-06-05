# Bed configuration moves inside the "Linge de lit" option card

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/bed-config-in-linen-card` _(user-managed)_ |
| **Created** | 2026-06-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A reservation today carries three discrete bed counts:
`singleBeds`, `doubleBeds`, `babyBeds` (nullable INTEGER columns on
`reservations`). They are edited in the **Voyageurs et couchages**
card on the reservation form
([client/src/components/reservation/GuestsBedsSection.js:87-137](client/src/components/reservation/GuestsBedsSection.js#L87-L137)),
alongside guest counts (adults / children / teens / babies).

The bed counts are used **only** by the weekly bed-linen feature
(specs/weekly-bed-linen-tracking.md): the laundry aggregator sums
`singleBeds + doubleBeds + babyBeds` across reservations whose
`endDate` falls in the half-open `(L-7d, L]` window AND whose options
include at least one row flagged `countsAsBedLinen = 1`
([server/src/models/laundryModel.js:41-84](server/src/models/laundryModel.js#L41-L84)).

The bed-linen option itself is a regular catalog option carrying the
`countsAsBedLinen = 1` flag (and per-bed-type include flags:
`linenIncludesSingle / Double / Baby`). The operator toggles it on /
off per reservation via the **Options** section
([client/src/components/reservation/ExtrasSection.js:55-189](client/src/components/reservation/ExtrasSection.js#L55-L189)).

**The disconnect** — today nothing in the form ties the two together:
- The operator can enter 4 doubles + 2 simples without checking that
  the bed-linen option is enabled. The bed counts then live in the
  reservation row but contribute zero to the laundry aggregation
  because the bed-linen option isn't ticked (per the SQL).
- Conversely the operator can leave the inputs empty while ticking
  the bed-linen option, producing a silent "0 sheets to drop off"
  for a reservation that obviously has beds.

The intent is clear: **bed counts are part of the bed-linen
contract**, not a generic reservation property. They should live
inside the bed-linen option card and only be editable when the option
is active.

## 2. Goal

The operator configures bed counts (doubles / simples / bébé) **only
inside the "Linge de lit" option card**, and only when the option is
enabled. Existing reservations that don't carry the bed-linen option
get their bed counts zeroed automatically so the data state matches
the new invariant.

## 3. Functional rules

1. **Bed counts move out of "Voyageurs et couchages"** — the three
   `TextField`s (Lits doubles / Lits simples / Lits bébé) are
   removed from `GuestsBedsSection`. The card stays, renamed to
   **"Voyageurs"** (it still holds the 4 guest counts + the
   capacity-exceeded warning).
2. **Bed counts appear inside the "Linge de lit" option card** —
   when the option is enabled (Switch ON), the three `TextField`s
   are rendered below the existing quantity + complement row, inside
   the same card.
3. **Bed counts are hidden when the option is OFF** — when the
   operator turns the Switch OFF (or never turns it ON), the inputs
   are not rendered. The form state for `singleBeds / doubleBeds /
   babyBeds` is reset to empty strings the moment the Switch flips
   to OFF (auto-zero). Toggling back ON starts with empty inputs.
4. **The "Linge de lit" option card is always shown when the option
   is in the property catalog** — whether the property auto-includes
   it as a default or not. No new rendering condition. This is
   already the current behaviour; the spec just pins it so a future
   refactor doesn't silently hide the card when the option is a
   property default.

   **4.bis (hotfix 2026-06-05 follow-up)** — **A bed-linen-flagged
   option that is configured as a property default is forced ON and
   the Switch is disabled.** The operator cannot remove it from a
   reservation form (the property contract says it's mandatory).
   This applies to BOTH new reservations (the option already auto-
   merges via the existing property-defaults logic on the create
   path) AND existing reservations (where pre-default-era rows may
   carry no entry in `reservation_options` despite the property now
   declaring the option as a default). The Switch shows checked +
   `disabled`; the bed inputs sub-block is rendered as if the option
   were enabled; the bed-counts auto-zero on Switch OFF (rule 3) is
   unreachable because the operator cannot turn the Switch off.
5. **Capacity validation only fires when the option is enabled** —
   `exceedsSingleBedsLimit / exceedsDoubleBedsLimit /
   bedsCapacityMismatch` only render their error messages when the
   bed-linen option is ON. When it's OFF, the bed counts are zero
   and there is nothing to validate.
6. **"Suggérer les lits" moves with the inputs** — the button (today
   below the bed inputs in `GuestsBedsSection`) follows them into
   the "Linge de lit" card. It is rendered only when the option is
   enabled.
7. **Server-side invariant on save (create + update)** — the
   reservation controller forces `singleBeds / doubleBeds / babyBeds`
   to `0` whenever the final `reservation_options` (after the
   property-defaults merge described below) contains **no** option
   flagged `countsAsBedLinen = 1`. This protects the DB from a
   misbehaving client (or a future spec change that bypasses the UI).

   **Bed-linen-only property-defaults merge on update** — on `create`
   the controller already merges ALL property defaults into
   `reservation_options` (idempotent, existing behaviour). On
   `update`, historical preservation (other-spec rule 30) keeps the
   operator's original option set frozen — EXCEPT for options
   flagged `countsAsBedLinen = 1`, which are always re-merged from
   `property_option_defaults` before the invariant runs. This makes
   the operator's intent ("this property always includes bed
   linen") sticky across edits without bleeding into unrelated
   defaults (e.g. a one-off "Petit-déjeuner" that wasn't included
   on the historical reservation).
8. **One-shot data migration at boot** — a new idempotent migration
   block in `database.js` zeroes `singleBeds / doubleBeds / babyBeds`
   for every reservation that has no bed-linen-flagged option in
   `reservation_options` AND no bed-linen-flagged option in the
   property's `property_option_defaults`. (The property-default
   fallback is honoured because the laundry aggregator already uses
   it as a fallback source — keeping that consistency.) The
   migration runs once, tracked in the `migrations` table.
9. **Auto-fill when a property-default reservation is created** —
   when the property has bed-linen as a default, the option is
   auto-added at create time (current behaviour). The bed inputs
   become editable as soon as the form renders, no extra clicks
   needed.
10. **Multi-bed-linen-option edge case** — if the catalog contains
    more than one option flagged `countsAsBedLinen = 1` (rare; in
    practice there's only the seeded "Linge de lit"), the bed inputs
    are rendered **only under the first enabled bed-linen-flagged
    option** in the rendered order. All cards share the same form
    state (`form.singleBeds` etc.), so this is purely a layout
    decision; enabling a second bed-linen option doesn't duplicate
    the inputs.

**Edge cases:**
- Operator enters `4` doubles, then turns the Switch OFF → form
  state becomes `{ doubleBeds: '', singleBeds: '', babyBeds: '' }`
  immediately; on save the controller writes `0/0/0` (rule 7
  re-confirms the same).
- Operator opens an existing reservation that already has bed
  counts but the bed-linen option is OFF (only possible pre-
  migration). After the boot migration: the bed counts are `0`, the
  Switch is OFF, the card has no inputs — clean state.
- Operator opens an existing reservation on a property where bed-
  linen is a property default but the reservation pre-dates the
  default and has no row in `reservation_options`. The migration
  treats the property default as "has bed linen" → bed counts stay.
  On next save, the controller's create/update path produces the
  expected `reservation_options` row (via auto-merge on create; for
  update, the row stays absent — but the property default still
  drives the laundry aggregation).
- Operator skips on a property that has NO bed-linen option in its
  catalog at all → no card to render; bed inputs never appear. The
  reservation's bed counts stay at `0` per the migration / save
  invariant.

---

## 4. Architecture

> **Fat backend, thin frontend.** The save-time invariant lives on
> the server (rule 7) so the DB is consistent even if a misbehaving
> client sends bed counts without the option. The client only
> renders + auto-zeroes the form state on Switch toggle for instant
> feedback; the truth is whatever the server stores after save.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/reservationsController.js` | T | At save (create + update), if the final `reservation_options` contains no option with `countsAsBedLinen = 1`, force `singleBeds / doubleBeds / babyBeds` to `0` before calling the model. Capacity validation (`checkCapacity`) also gates on this so the operator can't trip the "exceeds property capacity" error on an OFF option (the values would be 0 anyway, but it keeps the check shape consistent). |
| `models/` | `models/optionsModel.js` (or `controllers/...` if no model fn exists) | T (or —) | If `optionsModel.listAllWithLinenFlag()` (or equivalent) is missing, add a single tiny helper for the controller to ask "does this option list contain a `countsAsBedLinen = 1`?" — pure read, single query. |
| `database.js` | `database.js` | T | NEW idempotent migration block `zero_beds_when_no_bed_linen_option` (one-shot SQL): `UPDATE reservations SET singleBeds = 0, doubleBeds = 0, babyBeds = 0 WHERE ...` (see §5 for the full query). Tracked in the `migrations` table. |
| `tests/` | `tests/reservations-controller-bed-linen-invariant.unit.test.js` | C | 5 cases (see §7). |
| `tests/` | `tests/database-migration-zero-beds.unit.test.js` | C | 4 cases (see §7). |

**Notes:**
- No new endpoint, no API contract change. The server simply enforces
  an invariant on the existing `POST/PUT /api/reservations` shapes.
- The migration runs once at boot; subsequent boots are no-ops
  (tracked in the `migrations` table).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/reservation/GuestsBedsSection.js` | T | REMOVE the 3 bed `TextField`s (lines 87-137), REMOVE the "Suggérer les lits" button block (lines 139-150), REMOVE the `bedsCapacityMismatch` warning (lines 152-156). Rename the card title from "Voyageurs et couchages" to **"Voyageurs"**. |
| `components/` | `components/reservation/ExtrasSection.js` | T | Inside the per-option card render block (lines 70-185), when `enabled === true` AND the option is `countsAsBedLinen = 1`, render a sub-section below the quantity/complement row containing the 3 bed `TextField`s + the "Suggérer les lits" button + the capacity-mismatch warning. The block is only rendered **once per form** — for the first matching enabled option (rule 10). |
| `pages/` | `pages/ReservationPage.js` | T | (1) Extend the `setOptionEnabled(optionId, false)` path for a `countsAsBedLinen = 1` option so it ALSO resets `singleBeds / doubleBeds / babyBeds` to `''` in form state (auto-zero on Switch OFF, rule 3). (2) Wire `propertyOptions` + `form.selectedOptions` into the new `bedLinenOptionEnabled` boolean exposed via the `ReservationFormContext` — used by `ExtrasSection` to decide which option card hosts the bed inputs, and by `GuestsBedsSection` to suppress the (now-removed) bed inputs. |
| `components/` | `components/reservation/ReservationFormContext.js` | T | Expose two new context values: `firstEnabledBedLinenOptionId` (the option id of the first enabled `countsAsBedLinen = 1` option, or `null` when none are enabled) and `bedLinenOptionEnabled` (= `firstEnabledBedLinenOptionId !== null`). The capacity errors (`exceedsSingleBedsLimit`, `exceedsDoubleBedsLimit`, `bedsCapacityMismatch`) already exist; they gate on the new boolean for rendering (the math itself remains the same). |
| `tests/` | `client/src/components/__tests__/ExtrasSection.bed-linen-inputs.test.js` | C | 4 Vitest cases (see §7). |
| `tests/` | `client/src/components/__tests__/GuestsBedsSection.no-beds.test.js` | C | 2 cases pinning the removal (no `TextField` with `aria-label` matching `Lits` rendered). |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Card`, `CardContent`, `TextField`, `Box`, `Stack`, `Button`, `Typography` (MUI), `AutoFixHighIcon` (icon). | All pre-existing. The new "bed inputs sub-section" inside `ExtrasSection` is a layout, not a new generic component — it's tightly coupled to the bed-linen option's data shape. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | The bed inputs sub-block (3 `TextField`s + button + warning) inside `ExtrasSection`. Kept as inline JSX (~40 lines) because it's used exactly once and depends on the reservation form context's bed-validation values. A `BedLinenInputsSubsection.js` component would only be a 1-call wrapper. |

### 4.3 API contract

No new endpoints. The existing reservation `POST` and `PUT` payloads
keep the same shape (still carry `singleBeds / doubleBeds / babyBeds`).
The server now **silently coerces** them to `0` when no bed-linen
option is in `reservation_options` (rule 7). The error shape doesn't
change.

---

## 5. Data model

No schema change. The three columns
(`reservations.singleBeds / doubleBeds / babyBeds`) stay as nullable
INTEGER. The semantics shift: `> 0` is meaningful only when the
reservation carries (or has via property default) a bed-linen-flagged
option.

### Migration: `zero_beds_when_no_bed_linen_option`

Idempotent SQL run once at boot, tracked in the `migrations` table:

```sql
UPDATE reservations
SET singleBeds = 0, doubleBeds = 0, babyBeds = 0
WHERE kind = 'reservation'
  AND id NOT IN (
    -- Has an explicit bed-linen-flagged option in reservation_options
    SELECT DISTINCT ro.reservationId FROM reservation_options ro
    JOIN options o ON o.id = ro.optionId
    WHERE o.countsAsBedLinen = 1
  )
  AND propertyId NOT IN (
    -- Property declares a bed-linen-flagged option as a default
    SELECT DISTINCT pod.propertyId FROM property_option_defaults pod
    JOIN options o ON o.id = pod.optionId
    WHERE o.countsAsBedLinen = 1
  );
```

**Data impact:** existing reservations that currently carry non-zero
bed counts but no bed-linen option (and whose property doesn't list
the bed-linen option as a default) get their bed counts set to `0`.
These rows contributed `0` to the laundry aggregation anyway (the
SQL requires a flagged option to count), so the visible laundry
totals do not change. The before/after difference is purely cosmetic
("Voyageurs et couchages" used to display `4 doubles` for such
reservations even though no laundry was emitted).

**Risk of loss:** none for the laundry feature (the values were never
counted). Theoretical risk for any future consumer that reads
`reservations.singleBeds` for a purpose other than laundry — there
isn't one today (`git grep` of the column shows only the laundry
model + the reservation form).

## 6. UI / UX

### Before / after for the reservation form

**Before** — top of the form:

```
┌ Voyageurs et couchages ────────────────────┐
│ Adultes : [2]  Enfants : [1]               │
│ Ados : [0]    Bébés : [0]                  │
│                                            │
│ Lits doubles : [1]  Lits simples : [2]     │
│ Lits bébé : [0]                            │
│ [Suggérer les lits]                        │
└────────────────────────────────────────────┘

(lower in the form, in "Options et ressources")
┌ Linge de lit · [Switch ON]   Total: 25 € ──┐
│ Qté : [1]  Force compl. : [Switch OFF]     │
└────────────────────────────────────────────┘
```

**After** — top of the form:

```
┌ Voyageurs ─────────────────────────────────┐
│ Adultes : [2]  Enfants : [1]               │
│ Ados : [0]    Bébés : [0]                  │
└────────────────────────────────────────────┘

(lower in the form, in "Options et ressources")
┌ Linge de lit · [Switch ON]   Total: 25 € ──┐
│ Qté : [1]  Force compl. : [Switch OFF]     │
│                                            │
│ Configuration des lits :                   │
│ Lits doubles : [1]  Lits simples : [2]     │
│ Lits bébé : [0]                            │
│ [Suggérer les lits]                        │
└────────────────────────────────────────────┘

When the Switch is OFF the card collapses to:
┌ Linge de lit · [Switch OFF]                ┐
└────────────────────────────────────────────┘
```

### Copy (French strings)

- Card title in `ExtrasSection`'s bed-linen sub-block:
  `Configuration des lits`
- TextField labels: `Lits doubles`, `Lits simples`, `Lits bébé`
  (unchanged from today).
- Button label: `Suggérer les lits` (unchanged).
- "Voyageurs et couchages" → renamed to `Voyageurs`.

### Empty / error / loading states

- **No bed-linen option in the property catalog** → no inputs
  anywhere on the form. The reservation has no bed-linen contract;
  bed counts are not configurable.
- **Property has the option as a default** → the option auto-
  toggles ON at create time; the bed inputs are visible from the
  first render. Operator can still un-toggle (but the server
  re-merges on the next create; on update the un-toggle sticks).
- **Capacity exceeded** → existing red helperText below the
  offending `TextField` (`Maximum logement: 4`), unchanged.

### Responsive behaviour (mandatory)

- `xs` (≤600px): bed inputs stack vertically inside the card, full
  width. The "Suggérer les lits" button stretches to `width: 100%`
  on `xs` (was already aligned to the right on `sm+`).
- `sm` / `md` (≥600px): the 3 bed inputs sit on a `grid-template-
  columns: repeat(3, minmax(0, 1fr))` row; the button stays right-
  aligned below.
- `lg` (≥1200px): same as `md`, no additional layout shift.

The change does not introduce any new horizontal scroll. The padding
inside the option card stays at `p: 1.5` (default for option cards).

### `PageActionBar`

`ReservationPage` already exposes its `PageActionBar` (Save / Cancel
/ Delete + page-specific actions like "Synchroniser Google",
"Télécharger PDF"). This change adds no action — the bed inputs are
just form fields. Action bar contract is preserved.

---

## 7. Test plan

### 7.1 Server unit tests

| File | Cases |
|---|---|
| **NEW** `tests/reservations-controller-bed-linen-invariant.unit.test.js` | (1) Create with bed-linen option + bed counts → counts persisted. (2) Create without bed-linen option (and no property default) + bed counts > 0 → counts coerced to 0 before insert. (3) Create on a property that defaults to bed-linen → counts persisted (auto-merge re-adds the option). (4) Update with bed-linen option turned OFF + bed counts > 0 → counts coerced to 0. (5) Update keeping the bed-linen option ON → counts persisted. |
| **NEW** `tests/database-migration-zero-beds.unit.test.js` | (1) Reservation with bed-linen option in reservation_options → bed counts untouched. (2) Reservation without bed-linen option, on a property with bed-linen as default → bed counts untouched. (3) Reservation without bed-linen option AND on a property without the default → bed counts zeroed. (4) Migration is idempotent (running twice doesn't re-zero or re-trigger). |

Expected: existing **1006** + **5 + 4** = **1015** server tests.

### 7.2 Client unit tests (Vitest)

| File | Cases |
|---|---|
| **NEW** `client/src/components/__tests__/ExtrasSection.bed-linen-inputs.test.js` | (1) Option enabled → 3 bed `TextField`s + "Suggérer les lits" button rendered inside the option card. (2) Option disabled → no bed `TextField` in the card. (3) Toggling the Switch from ON to OFF auto-zeros the form's `singleBeds / doubleBeds / babyBeds` to `''`. (4) Two bed-linen-flagged options both enabled → bed inputs rendered exactly once (under the first one in catalog order). |
| **NEW** `client/src/components/__tests__/GuestsBedsSection.no-beds.test.js` | (1) Card title is "Voyageurs" (not "Voyageurs et couchages"). (2) No `TextField` with label `Lits doubles / Lits simples / Lits bébé` is rendered. |

Expected: existing **227** + **4 + 2** = **233** Vitest cases.

### 7.3 E2E (Playwright)

No new E2E. The existing reservation-edit smoke
(`e2e/specs/reservations/*.spec.js`) covers the happy path. Add a
manual UI check.

### 7.4 Manual UI verification

- [ ] On a fresh reservation, no bed-linen option in the catalog →
      "Voyageurs" card has no bed inputs; the rest of the form is
      unchanged.
- [ ] On a fresh reservation with bed-linen as a property default →
      the option card auto-toggles ON; bed inputs are visible and
      editable.
- [ ] Manually toggle the bed-linen Switch ON → 3 bed inputs +
      "Suggérer les lits" appear. Click the button → inputs auto-
      fill based on the property + guest count.
- [ ] Toggle the Switch OFF → inputs disappear, form state for
      bed counts is `''`. Save → DB has `0/0/0`.
- [ ] Edge case: enter `99` simples → red helperText `Maximum
      logement: 6` appears below the input.
- [ ] Toggle OFF on a reservation that already had counts → no save
      blocked, save persists `0/0/0`, the planning's `À apporter`
      counts drop by the deferred amount.
- [ ] Resize to `xs` (mobile) → bed inputs stack vertically, button
      full-width.

---

## 8. Out of scope

- **Per-option-card bed inputs.** Only the FIRST enabled bed-linen-
  flagged option hosts the inputs (rule 10). Showing them under
  every enabled bed-linen-flagged option would visually duplicate
  the same form state — out of scope.
- **Towel counts moved inside "Linge de toilette" option.** Towels
  are computed from `adults + teens + children` × per-person
  rates; there is no discrete per-reservation count to move. The
  "Linge de toilette" option card stays unchanged.
- **Server-side per-bed-type validation against
  `linenIncludesSingle / Double / Baby`.** If the bed-linen option
  has `linenIncludesBaby = 0`, the operator can still enter baby
  bed counts (they just won't contribute to laundry). Adding a
  cross-validation here would surprise operators who use the
  `linenIncludes*` flags only for laundry, not data entry. Out of
  scope.
- **Visual distinction of "property-default" bed-linen option.**
  Today no visual cue differentiates an auto-added option from a
  manually-toggled one. This spec doesn't change that.

---

## 9. Open questions

(All resolved before moving Status to Approved.)

1. ✅ **Placement of bed inputs** → Inside the existing "Linge de
   lit" option card, below the quantity / complement row (Switch
   ON only). Not in a separate top-level section.
2. ✅ **Behaviour when Switch turns OFF after counts were saisis** →
   Auto-zero the form state immediately; server enforces the same
   on save.
3. ✅ **Capacity validation when option is OFF** → No render of
   error messages; the math remains the same but the rendering
   gates on `bedLinenOptionEnabled`.
4. ✅ **Migration for existing data** → One-shot at boot, idempotent
   via the `migrations` table.

---

## 10. Implementation progress

_(Filled in as commits land. Update this section in the same commit
that ships each step, per CLAUDE.md §4.1.)_

- [x] Server: migration block in `database.js` + tests
      (`utils/zeroBedsWhenNoBedLinenMigration.js` + 5 unit cases).
- [x] Server: invariant in `reservationsController` (create + update)
      + 5 unit cases pinning the contract.
- [x] Client: `ReservationFormContext` exposes
      `firstEnabledBedLinenOptionId` + `bedLinenOptionEnabled`.
- [x] Client: `GuestsBedsSection` stripped (renamed `Voyageurs`,
      inputs + button + warning removed).
- [x] Client: `ExtrasSection` renders the `BedLinenInputsBlock`
      sub-component inside the first enabled bed-linen-flagged
      option card.
- [x] Client: `setOptionEnabled(optionId, false)` for a bed-linen-
      flagged option auto-zeroes `form.singleBeds / doubleBeds /
      babyBeds`.
- [x] Client tests (Vitest 4 + 2) + manual UI check on
      reservation #12077 (dev DB).
- [x] Docs: spec status → Implemented, CHANGELOG entry.
- [x] **Hotfix 2026-06-05 follow-up** — Adrien reported that on his
      Gite (which has `Linge de lit` as a property default), existing
      reservations whose `reservation_options` predate the default
      were showing the Switch OFF instead of ON. The initial commits
      treated `form.selectedOptions` as the sole source of truth for
      Switch state, ignoring the property contract. Fix: (a) server
      `update` handler re-merges `countsAsBedLinen = 1` property
      defaults before the invariant runs; (b) client exposes
      `propertyDefaultOptionIds` on the form context, forces the
      Switch ON + disabled for any bed-linen-flagged option that's
      a property default, and extends
      `firstEnabledBedLinenOptionId` to include property-default
      lookups (so the bed inputs sub-block surfaces correctly). +2
      tests (1 server, 1 Vitest).
