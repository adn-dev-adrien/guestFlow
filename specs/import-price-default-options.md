# Price paid default options at iCal/Lodgify import time

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/import-price-default-options` _(user-managed)_ |
| **Created** | 2026-07-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [arrival-departure-sas.md](arrival-departure-sas.md) _(unrelated)_, iCal sync in `propertyIcalModel.js` |

---

## 1. Context

When a reservation is created by the iCal / Lodgify import, its **paid default options**
(« obligatoire par défaut mais payante » = a `property_option_defaults` row with `offered = 0`)
are displayed with an amount of **0 €**. The operator's only workaround is to open the reservation
and **save it unchanged**; the save recomputes and persists the amounts, and reopening shows the
correct figures.

**Root cause (confirmed by code read + adversarial verification).** The import create path attaches
the property defaults via `applyPropertyOptionDefaults` in
[`propertyIcalModel.js:307-339`](../server/src/models/propertyIcalModel.js#L307-L339). Its INSERT
statement [`propertyIcalModel.js:326-329`](../server/src/models/propertyIcalModel.js#L326-L329) writes
`VALUES (?, ?, 1, 0, 0, ?, 0, ?)` — `quantity`, `unitPrice`, `billedUnits`, `totalPrice` are **SQL
literals**; only `optionId`, `priceType` and `offered` are bound. So a paid default lands with all
money fields at 0, identical to a free (`offered = 1`) default. The pricing engine
(`calculateReservationQuote`, [`pricing.js:917`](../server/src/utils/pricing.js#L917)) is **never
called** at import. The load-time SQL fallback in `getByIdWithDetails`
([`reservationsModel.js:322-326`](../server/src/models/reservationsModel.js#L322-L326)) cannot rescue
it either: `billedUnits` was persisted as a literal `0` (not NULL), so
`COALESCE(billedUnits, quantity, 0)` short-circuits to 0 → `price × 0 = 0`.

**Why save fixes it.** The update path (`reservationsController` → `calculateReservationQuote` →
`reservationsModel.replaceOptions`/`insertOptions`) reprices every option (per-property price via
`property_option_prices`, quantity via `getTypeMultiplier(priceType, persons, nights)`) and persists
the real `unitPrice`/`billedUnits`/`totalPrice`. Reopening reads those non-zero values.

The current 0-pricing is **deliberate at the reservation level** (comment
[`propertyIcalModel.js:300-306`](../server/src/models/propertyIcalModel.js#L300-L306): "iCal
reservations stay unpriced — the platform handles payment"). That intent is correct for the
**reservation totals** (a platform booking's owner-net is not the rate-card price), but it wrongly
also zeroes the **option lines**, which the operator does need to see.

## 2. Goal

An iCal/Lodgify-imported reservation shows its paid default options at their **correct amount
immediately** — no more save-to-fix. Free (`offered = 1`) defaults stay at 0. If a later re-sync
changes a still-pristine reservation's stay, its option amounts are kept in sync too (a `per_night`
default follows the new number of nights). The reservation-level totals
(`finalPrice`/`deposit`/`balance`/`complement`) remain intentionally unpriced until the operator saves
(unchanged from today).

## 3. Functional rules

1. **Price default option lines at import.** In `applyPropertyOptionDefaults`, run the authoritative
   pricing engine (`calculateReservationQuote`) for the property's non-internal-linen default options
   and persist the engine-computed `quantity` / `unitPrice` / `billedUnits` / `totalPrice` on each
   `reservation_options` row — instead of literal zeros.
2. **Free defaults stay free.** Pass `offeredOptionIds = [defaults where offered = 1]` so
   `applyOfferedToLine` ([`pricing.js:673-680`](../server/src/utils/pricing.js#L673-L680)) zeroes their
   `totalPrice` while keeping `unitPrice`/`originalTotalPrice` — exactly as a save does. `offered`
   persists as 1.
3. **Per-property prices honoured.** The engine reads `property_option_prices` (override) else the
   option base price ([`pricing.js:690,697`](../server/src/utils/pricing.js#L690)); no extra work.
4. **Stay-driven quantity.** The engine computes `billedUnits = quantity × getTypeMultiplier(priceType,
   persons, nights)`. `nights` comes from the imported dates; `persons` from `event.adults` (children/
   teens/babies = 0, matching the values the import row itself stores). This reproduces exactly what a
   post-import save would compute — no divergence.
5. **Reservation totals stay unpriced.** Only the option **lines** are priced. The `reservations` row
   keeps `totalPrice = finalPrice = depositAmount = balanceAmount = 0` as today (the operator's save
   still reconciles the finance totals — unchanged behaviour).
6. **Never break an import (robustness).** The engine call is guarded: on any failure (e.g. a minimal
   test schema without the pricing tables), it **falls back to the legacy zero-amount insert** so the
   reservation still imports. This preserves the existing behaviour where prod/dev always have the
   tables and minimal test schemas degrade to a no-op.
7. **Applies to both create branches.** The new-event branch and the re-create branch (a mapped
   reservation whose row was deleted) both pass the stay data and price the defaults.
8. **Re-sync reprices pristine reservations.** When a re-sync updates a **non-locked** iCal reservation
   (its feed event changed — e.g. new dates), its existing option lines are repriced for the new stay via
   the same engine (`repriceReservationDefaultOptions`), so a `per_night` default follows the new number
   of nights. **Locked reservations are never touched:** any manual edit locks an iCal reservation
   (`computeNextIcalSyncLocked` → `sourceType = 'ical'` ⇒ 1) and diverts re-syncs to the date-drift
   approval flow (`shouldSkipIcalReservationUpdate`), so no operator customisation is ever overwritten.
   The create (insert) and re-sync (in-place update) paths share one pricing helper
   (`priceOptionLinesById`) so option pricing stays single-sourced.

**Edge cases:**
- Engine drops an option not linked to the property (`property_options`) → no line → that option falls
  back to 0 (unchanged from today; a mis-configured default was never priceable anyway).
- iCal feed with no guest count → `persons` defaults to 1 (`adults || 1`) → `per_person` options price
  at ×1, identical to an immediate save (not a regression).
- Auto-timed options (`early_check_in` / `late_check_out` / `bed_linen` via `autoEnabled`) are **not**
  in `property_option_defaults`, so they are untouched here.

---

## 4. Architecture

> **Fat backend.** The fix keeps ALL pricing in the authoritative engine (`pricing.js`). The import
> model merely calls it and persists the returned lines — no pricing logic is duplicated.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| models | `models/propertyIcalModel.js` | T | `require('../utils/pricing')`; add a shared `priceOptionLinesById(propertyId, stay, optionRows)` helper (guarded engine call → Map). `applyPropertyOptionDefaults` uses it to bind engine `quantity/unitPrice/billedUnits/totalPrice/offered` on insert (statement changed to bind the 4 amount columns); a new `repriceReservationDefaultOptions` uses it to UPDATE existing option amounts on a non-locked re-sync. Pass `stay` ({ startDate, endDate, checkInTime, checkOutTime, adults }) from both create call sites and the non-locked update branch. |
| utils | `utils/pricing.js` | — | **No change** — reused as-is (`calculateReservationQuote`, `offeredOptionIds`). |
| models | `models/reservationsModel.js` | — | No change. |
| database | `database.js` | — | No migration. |

No circular dependency: `pricing.js` requires only `./resourceHourlyPricing`; `propertyIcalModel.js`
is never required by `pricing.js`.

### 4.2 Client side (`client/src/`)

No change. The fiche already renders `reservation_options` amounts from the server payload
(`getByIdWithDetails`).

### 4.3 API contract

Unchanged. No endpoint added or modified.

---

## 5. Data model

No schema change, no migration. Existing already-imported reservations that still show 0 are **not
back-filled** by this change (a save fixes any individual one, as before) — see Out of scope. New
imports from the deploy onward are priced correctly.

## 6. UI / UX

No visual change to build. Behavioural: on the reservation fiche of a freshly-imported booking, a paid
default option now shows its real amount (e.g. « Ménage : 60 € ») instead of 0 €. The reservation
finance totals still read 0 until the operator saves (unchanged). Responsive: N/A (no UI code touched).

## 7. Test plan

### Server unit tests (`server/src/tests/import-price-default-options.unit.test.js` — new) — 4/4 green
- [x] Full schema (import tables + pricing tables: `pricing_rules`, `property_options`,
  `property_option_prices`, `app_settings`). Seed a **paid** default (`offered = 0`, `per_stay`, base
  40, per-property override 60) and a **free** default (`offered = 1`, base 25). Stub the feed, run
  `syncSource`. Asserted: paid default `reservation_options.totalPrice = 60` (override wins), `offered = 0`,
  `unitPrice = 60`, `billedUnits = 1`; free default `totalPrice = 0`, `offered = 1`; the `reservations`
  row keeps `finalPrice = 0` and `totalPrice = 0` (still unpriced).
- [x] `per_night` paid default over a 3-night stay prices at `3 × unit` (`billedUnits = 3`, `totalPrice = 60`).
- [x] **Re-sync reprices a pristine reservation** (rule 8): first sync a `per_night` default (3 nights →
  billed 3), then re-sync the same UID with a 5-night stay → the option reprices to `billedUnits = 5`,
  `totalPrice = 100`.
- [x] **Locked reservation is NOT repriced** (rule 8 safety): after locking the reservation, a re-sync with
  a longer stay leaves the option (`billedUnits = 3`, `totalPrice = 60`) and the dates untouched, and
  records a pending date-drift alert instead.
- [x] Engine-failure fallback: with a minimal schema (no pricing tables), `syncSource` still creates the
  option row at 0 without throwing (guards rule 6) — covered by the existing
  `property-ical-sync.unit.test.js` create tests, which stay green.

### Regression
- [x] `property-ical-sync.unit.test.js` (the 5-step sync contract) stays green (24/24) — its minimal
  schema degrades the engine call to the legacy 0-insert / no-op reprice, so its assertions hold.
- [x] Full server suite: 1993/1993 green.

### Manual verification
- [ ] After deploy, a real Lodgify import: the paid default option shows its amount on the fiche without
  a save. (Not exercisable in the dev sandbox without a live feed — called out at hand-off.)

## 8. Out of scope

- **Reservation-level pricing at import** — totals stay 0 by design (rule 5). Only option lines change.
- **Back-fill of already-imported reservations** currently showing 0 — one save fixes each; a bulk
  migration is not in scope.
- **inComplement routing / acompte-solde contribs at import** — left at their column defaults (as today);
  the operator's save sets them. The fix touches only `quantity/unitPrice/billedUnits/totalPrice/offered`.

## 9. Open questions

- **Resolved 2026-07-03:** scope = price option **lines** only, keep reservation totals unpriced
  (matches the deliberate "iCal stays unpriced" design and the reported symptom). No AskUserQuestion
  needed — the alternative (full reservation pricing) would compute a rate-card total that is wrong for
  a platform booking.
