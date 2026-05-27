# Pricing engine — server-authoritative quote, thin client

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/pricing-engine-thin-client` _(user-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 2 — Pricing engine (see `specs/ROADMAP.md`) |

---

## 1. Context

The server already owns a complete pricing engine. `POST /api/reservations/calculate-price`
([reservations.js:501](../server/src/routes/reservations.js#L501)) calls
`calculateReservationQuote` ([pricing.js:755](../server/src/utils/pricing.js#L755)), which returns a
fully-shaped `quote`: nightly breakdown, options/resources line totals, subtotal, discount, final
price, deposit/balance (with paid-flag handling), due dates, tourist tax, VAT breakdown
([pricing.js:1230-1282](../server/src/utils/pricing.js#L1230-L1282)).

Despite this, the client **re-implements pricing**:

- **`CalendarPage.js`** keeps a local `recalcPrice` ([742-807](../client/src/pages/CalendarPage.js#L742-L807))
  that duplicates option/resource multipliers, subtotal, discount, and deposit/balance auto-calc. It is
  run on every form change via `updateForm`/`setOptionQuantity`/`setResourceQuantity`
  ([810](../client/src/pages/CalendarPage.js#L810), 828, 862, 937) — *while also* calling
  `api.calculatePrice` elsewhere ([546](../client/src/pages/CalendarPage.js#L546), 920, 1030). The two
  paths can disagree.
- **`PlanningPage.js`** has `getMultiplier`/`getEffectiveQty` ([138-162](../client/src/pages/PlanningPage.js#L138-L162))
  duplicating the server's per-person/per-night multiplier rules, only to render "×N" labels.

This violates CLAUDE.md §6 (fat backend, thin frontend): money math on the client is a correctness and
audit risk, and the duplicated rules drift. `ReservationPage.js` already does it right — a debounced
`useEffect` ([804-864](../client/src/pages/ReservationPage.js#L804-L864)) calls `api.calculatePrice`
then maps the quote onto the form via `applyQuoteToForm` ([354-408](../client/src/pages/ReservationPage.js#L354-L408)).

**The pricing engine is shared with devis.** `devis.js` imports and calls the same
`calculateReservationQuote` ([devis.js:6](../server/src/routes/devis.js#L6),
[394](../server/src/routes/devis.js#L394)) at save time, so the server-side changes here
(`engineFinalPrice`, `priceOverridden`, robust offered handling) benefit devis automatically.
Two devis specifics matter: (a) `devis.js` carries its **own** fragile offered inference in SQL
(`CASE WHEN totalPrice=0 AND unitPrice>0 THEN offered`, [devis.js:224,242](../server/src/routes/devis.js#L224)),
which must be reconciled or the offered bug persists for devis; (b) `DevisForm.js` shows **no live price
summary** today (just input fields) — it must be brought onto the same live-quote + summary pattern as
the other two pages.

Separately, the pricing entry point accepts money/percentage inputs with no range validation
(negative amounts, NaN, discount > 100% are not rejected at the boundary) — a correctness gap that also
feeds Bloc S (security).

## 2. Goal

Make the server the single source of truth for every price, deposit, balance, tax, and quantity
shown anywhere in the app. The client only sends inputs and renders the returned quote — it never
computes a money amount or a pricing multiplier again.

A reservation's final price can be **engine-computed** (default) or a **manual override** (the real
price the booking platform actually charged, typed by the user — the primary case for iCal-imported
reservations). The user can always see what the engine would compute and revert to it in one click.

## 2.bis Manual price override — context

iCal-imported reservations (Airbnb, Booking, …) carry no price, and platforms charge slightly
different amounts than our engine. The user needs to record the **exact amount actually earned**, so
they must be able to replace the engine price with the platform's real price, while still seeing what
the engine would have computed (to gauge the delta).

This already partly exists and is **reused, not rebuilt**:
- `reservations.customPrice` ([database.js:142](../server/src/database.js#L142)) is the override field.
- A "recompute with current pricing" flow exists via `useCurrentPricing` / `forceCurrentPricing`
  ([ReservationPage.js:1263](../client/src/pages/ReservationPage.js#L1263)).
- iCal reservations are already tagged: `sourceType='ical'`, `sourcePlatformKey`,
  `sourceIcalEventUid`, `icalSyncLocked` ([database.js:150-154](../server/src/database.js#L150-L154)),
  and the import already creates them with a blank price for the user to fill in.

The problem is that the override-preservation logic lives in the **client**
([ReservationPage.js:357-367](../client/src/pages/ReservationPage.js#L357-L367)). This spec moves the
concept server-side and exposes it cleanly in the finance section of the form.

## 3. Functional rules

1. **One pricing path.** All reservation pricing in the client goes through
   `api.calculatePrice` → server `quote`. No client code computes a price, subtotal, discount,
   deposit, balance, tourist tax, or line total.
2. **CalendarPage quick-create uses the server quote**, with the same debounced pattern as
   ReservationPage: on any pricing-relevant form change (dates, guests, options, resources,
   discount, custom price, platform, paid flags), the client debounces (~300 ms) and calls
   `api.calculatePrice`, then maps the returned quote onto the form (read-only fields).
3. **`recalcPrice` is deleted** from CalendarPage. Local form mutation for pricing fields is replaced
   by applying the server quote.
4. **PlanningPage renders server-provided quantities.** The reservation/planning list payload includes
   the effective quantity (and/or display label) per option and resource. `getMultiplier` /
   `getEffectiveQty` are deleted from the client.
5. **Quote mapping is shared, not duplicated.** The quote→form mapping currently in ReservationPage's
   `applyQuoteToForm` is extracted to a shared, page-agnostic helper consumed by both ReservationPage
   and CalendarPage. The debounced call pattern is extracted to a shared hook.
6. **Server validates money/percentage inputs at the pricing boundary.** `calculate-price` rejects
   (HTTP 400, French-free machine error) inputs that are: non-finite, negative amounts
   (`customPrice`, `depositAmount`, `balanceAmount`), or out-of-range percentages (`discountPercent`
   not in 0–100). Validation lives in a new pure util reused by Bloc S at other write boundaries.
7. **No behavior change in the computed numbers.** The amounts displayed after this change must equal
   what the server already returns today (the client simply stops second-guessing them). Existing
   locked-pricing snapshots (`lockedNightlyBreakdown`, etc.) keep working unchanged.

**Manual price override (server-owned):**

8. **Override = `customPrice`.** When `customPrice` is set, `finalPrice` equals it; the engine still
   computes everything else (deposit/balance derive from the effective final price; tourist tax,
   options/resources breakdown remain as reference). No new column — `customPrice` is reused.
9. **Quote always exposes the engine price.** The server returns both `engineFinalPrice` (what the
   engine computes from inputs, ignoring any override) and `finalPrice` (effective = override if set,
   else `engineFinalPrice`), plus `priceOverridden: boolean`. The client renders the delta (e.g.
   "Moteur : 420 €") when an override is active.
10. **"Recalculer le prix" reverts to the engine.** A single action in the finance section clears the
    override (`customPrice` → empty) and re-quotes; `finalPrice` falls back to `engineFinalPrice`.
    This consolidates today's `useCurrentPricing` / `forceCurrentPricing` flow into one explicit button.
11. **Override preservation is server-side.** The client no longer special-cases keeping `customPrice`
    when other fields change ([ReservationPage.js:357-367](../client/src/pages/ReservationPage.js#L357-L367)
    is removed). `customPrice` is just a form field sent with every quote request; the server honors it.
12. **iCal-imported reservations stay identifiable and keep their override.** `sourceType='ical'` and
    related columns are preserved for the reservation's whole life. A manual price set on an iCal
    reservation must survive iCal re-sync (`icalSyncLocked` already guards this — re-sync never wipes
    `customPrice` of a locked reservation). No engine price is forced onto a blank-price iCal import.

**Offered options/resources & VAT display (server-owned):**

13. **Offer system preserved.** "Offrir" an option/resource keeps its current UX: the price is shown
    struck through and the billed amount is 0. This is server-authoritative — the client only renders
    the `offered` flag + `originalTotalPrice` + `totalPrice` from the quote.
14. **Offered toggle is lossless (fixes the known bug).** The server always recomputes the *real* line
    price from the option/resource definition + reservation params. `offered=true` sets only the
    **billed** `totalPrice` to 0 while `originalTotalPrice` keeps the real price; flipping
    `offered=false` restores the real price — **even on a saved/locked reservation** (a closed
    reservation reopened with offered options, then made paid again, must show the real price, never 0).
    Today's fragile recovery (`offeredOptionIdSet.has(...) && total===0`, `shouldBypassLockedTotal`) is
    replaced by always-recompute + a billed-vs-real separation, covered by a round-trip unit test.
15. **Manual accommodation price display.** When `customPrice` is set, the summary shows the engine
    accommodation price **struck through** and the manual price **in green**. The manual price is the
    one used for the total stay and the accommodation VAT base — already the server's behavior
    (`accommodationAdjustedPrice` drives both `finalPrice` and `accommodationVatAmount`). This rule is
    about *display*; the computation already lives server-side.
16. **VAT/HT is server-only.** All prices in the summary are TTC; HT/VAT per category (accommodation,
    options, resources) is computed server-side in the quote (`accommodation/options/resourcesNetPrice`
    + `*VatAmount`). The client only renders these fields — no HT math anywhere on the client.
    CalendarPage inherits correct VAT for free once it consumes the quote (core of this spec).

**Devis parity (shared engine):**

17. **Devis uses the same engine and the same client pattern.** DevisForm gains a live quote via the
    shared hook (calling `api.calculatePrice` with devis inputs — the endpoint is a pure quote
    calculator, no reservation required) and renders the shared `PricingSummary`. Its "Prix custom"
    field becomes the shared `FinalPriceField` (manual price = override of accommodation, struck-engine
    + green display).
18. **Devis offered behavior is reconciled with the engine.** The fragile `totalPrice=0 → offered` SQL
    inference in `devis.js` is removed; offered state is sourced from the explicit `offered` column and
    the real line price is recomputed by the engine, so the lossless-toggle guarantee (rule 14) holds
    for devis exactly as for reservations.
19. **One summary component everywhere.** Reservation, Calendar, and Devis render the same generic
    `PricingSummary` (TTC totals, VAT/HT breakdown, offered strikethrough, manual-price struck/green).
    No page builds its own pricing summary markup.

**Summary display (from review feedback):**

20. **Lines follow the main list order.** The quote returns option/resource lines in the same order as
    the main options/resources list (catalog order = by title / name, server-sorted), not in insertion
    order. Custom options keep their input order at the end.
21. **"Recalculer / Actualiser les tarifs" clears the manual override.** Reverting to engine pricing
    also clears `customPrice` (sends `customPrice: ''`), so the final price falls back to the engine
    value. This covers both the planned `FinalPriceField` action and the existing "Actualiser tarifs"
    button on saved reservations.
22. **No redundant discount line in the summary.** The accommodation reduction is conveyed solely by
    the struck engine price + green effective price; the separate "Remise sur hébergement" line is
    removed.

**Edge cases:**
- Quote request in flight while the user keeps typing → debounce coalesces; only the latest result is
  applied (guard against out-of-order responses with a request token / latest-wins).
- Offered option on a locked reservation toggled back to paid → real price restored from the
  recomputed line, not the locked 0 (rule 14).
- Devis with a custom price → same struck-engine + green-custom display as reservations (rule 17).
- Server returns `{ error }` (e.g. min-nights breached, invalid input) → client shows the error state,
  does not overwrite the last good quote with garbage.
- Network failure on quote call → keep last displayed quote, surface a non-blocking error; do not fall
  back to client-side computation.
- `customPrice` set → server returns `priceOverridden: true`, `finalPrice = customPrice`,
  `engineFinalPrice` = what the engine would charge; client renders the override + the engine delta.
- "Recalculer le prix" pressed → `customPrice` cleared, `priceOverridden: false`, `finalPrice` =
  `engineFinalPrice`. On an edit with a locked snapshot this is the existing "use current pricing" path.
- iCal reservation with blank price, never edited → no engine price forced; stays blank until the user
  enters the platform amount (override).
- Empty/0-night selection → server returns its existing response; client renders, no local math.

---

## 4. Architecture

> **Fat backend, thin frontend.** The pricing engine stays entirely server-side. This spec *removes*
> logic from the client; the only client code added is plumbing (debounced call + render mapping) and
> shared UI state — explicitly no calculations.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | T | `calculate-price`: validate money/percentage inputs before quoting (delegate to new util). Add effective-quantity fields to the planning/list payload. iCal re-sync path: never overwrite `customPrice` of a locked reservation (verify existing `icalSyncLocked` guard). |
| `routes/` | `devis.js` | T | **Targeted only** (full MVC split is Bloc 4): remove the `totalPrice=0 → offered` SQL inference ([224,242](../server/src/routes/devis.js#L224)); source offered from the explicit column; rely on the engine for the real line price (rule 18). No other devis refactor. |
| `utils/` | `pricing.js` | T | `calculateReservationQuote` returns `engineFinalPrice` + `priceOverridden` alongside `finalPrice`. Deposit/balance keep deriving from effective `finalPrice`. **Rework the offered-line handling (rule 14):** always recompute the real line price; `offered` only zeroes the billed `totalPrice` while `originalTotalPrice` holds the real one; remove the fragile `total===0` recovery + `shouldBypassLockedTotal` hacks. Surface per-line effective quantity (no new math). |
| `utils/` | `financeValidation.js` | C | Pure validators: `validateMoneyAmount(v)`, `validatePercentage(v)`. Returns null or a machine error code. Unit-tested. Reused by Bloc S. |
| `controllers/` | — | — | Full reservations MVC extraction is **Bloc 3**, not here. Keep the route change minimal/targeted. |
| `database.js` | — | — | No schema change (`customPrice` + `sourceType`/`icalSyncLocked` already exist). |

**Notes:**
- Targeted edits only to `reservations.js` (its full controller/model split is Bloc 3). We add input
  validation, the engine/override fields, effective quantities, and confirm the iCal override guard —
  no broader refactor.
- `financeValidation.js` is a pure, unit-testable module designed for reuse at every write boundary.
- The override concept is pure data shaping on existing columns — no migration.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `CalendarPage.js` | T | Delete `recalcPrice`; consume the shared quote hook + mapping; render quote fields read-only. |
| `pages/` | `ReservationPage.js` | T | Replace inline `applyQuoteToForm` + debounce effect with the shared helper/hook; remove the client-side `customPrice` preservation special-case (rule 11); editable final-price field bound to `customPrice`; add "Recalculer le prix" action + engine-price reference in the finance section. |
| `pages/` | `PlanningPage.js` | T | Delete `getMultiplier`/`getEffectiveQty`; render server-provided effective quantities/labels. |
| `pages/` | `DevisForm.js` | T | Add a live quote via the shared hook (`api.calculatePrice` with devis inputs); replace the "Prix custom" field with `FinalPriceField`; render the shared `PricingSummary`. No client pricing math. |
| `hooks/` | `useReservationQuote.js` | C | Shared hook: debounced call to `api.calculatePrice` for a given input signature, latest-wins, exposes `{ quote, loading, error }`. Used by Reservation, Calendar, Devis. |
| `utils/` | `reservationQuote.js` | C | Pure `applyQuoteToForm(form, quote, opts)` mapping the server quote (incl. `engineFinalPrice`, `priceOverridden`) onto form state. No math — assignment only. |
| `components/` | `FinalPriceField.js` | C | Generic: editable price field showing the effective price, an inline engine-price reference/delta when overridden, and a "Recalculer le prix" action that clears the override. Used by all 3 pricing pages. |
| `components/` | `PricingSummary.js` | C | Generic: renders a server `quote` (TTC totals, VAT/HT breakdown, line items with offered strikethrough, struck-engine + green-manual accommodation price). Render-only. Adopted by Reservation (replacing its inline summary ~2880-3290 — **targeted swap**, not the Bloc 3 page split), Calendar, and Devis. |
| `api.js` | `api.js` | — | `calculatePrice` already exists ([api.js:103](../client/src/api.js#L103)); reused by devis; no change. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | (none new) | Pages keep their current dialogs/fields. |
| **Created (new generic)** | `useReservationQuote` (hook), `reservationQuote.applyQuoteToForm` (util), `FinalPriceField`, `PricingSummary` (components) | Generic because Reservation, Calendar **and** Devis all need identical debounced-quote + mapping + editable-price-with-recompute + summary rendering. Building these once and sharing them is the whole point of the bloc. |
| **Specific (kept feature-local)** | — | No page-specific pricing markup remains. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/calculate-price` | unchanged input set (propertyId, dates, guests, options, resources, discountPercent, customPrice, paid flags, platform, locked* …) | `200` quote with **new fields** `engineFinalPrice`, `priceOverridden` added to the existing shape **or** `400 { error: <code> }` when money/percentage inputs are invalid | New: boundary validation + engine/override fields. Existing fields unchanged. **Reused by DevisForm** for its live quote (pure calculator, no reservation needed). |
| POST/PUT | `/api/devis` | unchanged | unchanged | Server still computes the devis quote on save via the shared engine; offered now sourced from the explicit column (rule 18). No contract change. |
| GET | `/api/reservations` (+ planning list source) | unchanged | each option/resource line gains an effective-quantity field (and/or pre-formatted label) | Lets PlanningPage drop client multipliers. Backward-compatible addition. |

Error shape: `{ error: 'NEGATIVE_AMOUNT' | 'INVALID_PERCENTAGE' | 'NOT_A_NUMBER' | <existing pricing errors> }`. Existing pricing errors (e.g. min-nights) are unchanged.

**New quote fields:** `engineFinalPrice` (number — discount-applied computed price ignoring any override),
`priceOverridden` (boolean — true when `customPrice` is set). `finalPrice` stays the effective price
(= `customPrice` if overridden, else `engineFinalPrice`); deposit/balance keep deriving from it.

---

## 5. Data model

No schema changes. No migration. The manual override reuses the existing `reservations.customPrice`
column; iCal identification reuses the existing `sourceType` / `sourcePlatformKey` /
`sourceIcalEventUid` / `icalSyncLocked` columns. Locked-pricing snapshot columns are untouched and keep
driving the existing locked-quote behavior.

**Data impact:** none. Numbers rendered must match what the server already computes today; existing
`customPrice` and `sourceType` values keep their meaning.

## 6. UI / UX

**Finance section of the reservation form (`FinalPriceField`) — Reservation + Calendar:**
- The **final price field is editable**: typing a value sets the manual override (`customPrice`), which
  overrides the **accommodation** price (options/resources still add on top).
- When an override is active, the summary shows the **engine accommodation price struck through** and
  the **manual price in green** (e.g. ~~480 €~~ **450 €**), plus an inline "Moteur : 480 €" reference.
  The green manual price is the value used for the total stay and the accommodation VAT base.
- A **"Recalculer le prix"** action (icon button or small button, French tooltip "Recalculer au tarif
  du moteur") clears the override and re-quotes → the field shows `engineFinalPrice` again. On an
  existing reservation with a locked snapshot, this is the existing "use current pricing" confirm flow.
- Deposit / balance / due dates / tourist tax remain read-only reflections of the server quote and
  recompute from the effective price.

**CalendarPage quick-create dialog:**
- All other pricing fields (deposit, balance, due dates, tourist tax, option/resource line totals)
  become **read-only reflections of the server quote**. While a quote is recomputing after a change,
  show a subtle loading affordance (e.g. disable/spinner on the price area) and keep the last value
  until the new quote arrives — no flicker to 0.
- On quote error, show a small inline error (French) near the price; the form stays usable; the last
  good quote remains displayed.
- Copy: reuse existing French labels already in the dialog; new strings limited to the engine
  reference ("Moteur : {montant}"), the recompute action tooltip, a loading hint ("Calcul du tarif…")
  and an error hint ("Tarif indisponible, réessayez.").

**iCal-imported reservations:** no new visual badge in this spec (DB tag suffices for now). The
existing blank-price-on-import behavior is preserved; the user fills the platform price via the
editable final-price field. The source tag must not be lost on edit or re-sync.

**PlanningPage:** "×N" quantity labels now come from the server payload; visually identical to today.

**ReservationPage:** the finance section gains the editable price + engine reference + recompute action
(consolidating today's scattered "use current pricing" flow); its inline summary is swapped for the
shared `PricingSummary` (same visuals); pricing numbers otherwise unchanged.

**DevisForm:** gains a live `PricingSummary` (today it has none) that updates as the user edits, plus
`FinalPriceField` in place of the bare "Prix custom" input. The devis sees the same TTC totals, VAT/HT
breakdown, offered strikethrough, and struck-engine/green-manual price as the reservation pages.
Responsive: the summary follows `PricingSummary`'s responsive layout; on `xs` it stacks below the form.

- **Responsive behavior:** no layout change. CalendarPage dialog and ReservationPage already handle
  `xs`/`md`/`lg`; we only change where numbers come from. Verify the dialog price area still renders
  correctly on `xs` (mobile) with the loading/error states.
- **Sticky action bar (`PageActionBar`):** out of scope here. CalendarPage/ReservationPage `PageActionBar`
  migration is tracked in Bloc 3; this spec does not touch their action bars.

## 7. Test plan

### Server unit tests
- [ ] `tests/finance-validation.unit.test.js` — `validateMoneyAmount`/`validatePercentage`: rejects
      negative, NaN, >100%; accepts valid (rule 6).
- [ ] `tests/pricing-calculate-price-validation.unit.test.js` — `calculate-price` returns 400 on
      invalid money/percentage inputs, 200 + quote on valid (rules 6, 7).
- [ ] `calculateReservationQuote` returns `engineFinalPrice` + `priceOverridden`; with `customPrice`
      set → `finalPrice == customPrice`, `priceOverridden == true`, `engineFinalPrice` = computed;
      without → `finalPrice == engineFinalPrice`, `priceOverridden == false` (rules 8, 9).
- [ ] Deposit/balance derive from effective `finalPrice` in both modes (rule 8).
- [ ] Existing pricing unit tests still pass unchanged (rule 7 — no number change).
- [ ] Effective-quantity field present in list payload for per_person/per_night/per_person_per_night
      lines (rule 4).
- [ ] iCal re-sync of a locked reservation does not overwrite its `customPrice` / `sourceType` (rule 12).
- [ ] `tests/pricing-offered-roundtrip.unit.test.js` — option/resource toggled offered→0 billed,
      `originalTotalPrice` keeps real price; toggled back (incl. from a locked snapshot) restores the
      real price, never 0 (rule 14 — the reported bug).
- [ ] VAT/HT fields in the quote are computed on the manual `accommodationAdjustedPrice` when overridden
      (rules 15, 16).
- [ ] `tests/devis-offered-roundtrip.unit.test.js` — saving/reading a devis with an offered line keeps
      the real price recoverable; toggled back to paid restores it, no `totalPrice=0` inference (rule 18).

### Manual UI verification
- [ ] Happy path (CalendarPage): create a reservation, change dates/guests/options/discount → price,
      deposit, balance, due dates, tourist tax all update from the server, identical to ReservationPage
      for the same inputs.
- [ ] Manual override: type a final price → it sticks while changing other fields; engine reference +
      delta shown; deposit/balance recompute from the override.
- [ ] "Recalculer le prix": clears the override → field shows engine price again; deposit/balance follow.
- [ ] iCal flow: import (blank price) → reservation tagged iCal, no engine price forced → enter platform
      price → save → reopen: override + source tag preserved.
- [ ] Edge: rapid typing in discount/guests → only the final quote is applied (no stale value).
- [ ] Edge: trigger a min-nights breach → error state shown, last good quote not clobbered.
- [ ] Regression (ReservationPage): full create/edit flow unchanged (numbers + locked pricing on edit).
- [ ] Regression (PlanningPage): "×N" labels match previous behavior across price types.
- [ ] Devis: build a devis → live `PricingSummary` + VAT/HT update as inputs change; custom price shows
      struck-engine + green; offered option struck through; save → reopen: offered line shows real price.
- [ ] `PricingSummary` renders identically across Reservation, Calendar, and Devis for equal inputs.
- [ ] Mobile (`xs`): CalendarPage dialog price area + `FinalPriceField` + `PricingSummary` (incl. Devis)
      render with loading + error states.

## 7.bis Implementation notes & key discoveries (2026-05-27)

Implementing the client side revealed that **the live app already routes all reservation *and* devis
editing through a single page**, which changes the client scope substantially:

- **`CalendarPage` reservation dialog is dead code.** `setDialogOpen(true)` is never called;
  `openNewReservation` and all reservation clicks `navigate(...)` to `/reservations/...`. Its inline
  pricing (`recalcPrice`, the quote effect gated on `dialogOpen`) was unreachable. `recalcPrice` was
  removed as dead-code cleanup; full removal of the dead dialog is deferred to **Bloc 3**.
- **`DevisForm.js` is dead code** — not imported anywhere. `DevisPage` creates/edits devis via
  `/reservations/new?mode=devis[&devisId=...]`, i.e. **`ReservationPage` is the single live editor for
  both reservations and devis**. Removal of `DevisForm.js` is deferred to **Bloc 4**.
- **Consequence for rules 17–19 (devis parity / shared summary):** already satisfied *de facto* — devis
  use `ReservationPage`'s server-driven quote + summary today, including the offered fix (server) and
  the manual-price display. No `DevisForm` wiring is needed.
- **`PricingSummary` / `FinalPriceField` / `useReservationQuote` extraction is deferred (YAGNI).** The
  only live consumer of the pricing summary is `ReservationPage`; the other intended consumers
  (CalendarPage dialog, DevisForm) are dead code. Per CLAUDE.md component-reuse policy, extraction is
  justified by a real second consumer — which doesn't exist live. Extraction now would be a risky
  rewrite of a working ~400-LOC summary with no reuse benefit; it is revisited in **Bloc 3** when the
  CalendarPage refactor produces a genuine second consumer.

**Net Bloc 2 result in the live app:** server is the single pricing authority (offered fix, engine vs
override fields, money validation, server-sorted lines, server VAT/HT); `ReservationPage` (reservations
+ devis) renders the server quote with the manual-price struck/green display; `PlanningPage` renders
server `billedUnits`. The thin-frontend goal is met for every *live* pricing surface.

## 8. Out of scope

- ReservationPage capacity/bed-allocation math ([912-938](../client/src/pages/ReservationPage.js#L912-L938))
  and conflict detection (`utils/reservationConflicts.js`) → **Bloc 3** (decided).
- Price denormalization (stored vs computed prices, locked-snapshot strategy) → its own later spec (decided).
- Full MVC extraction of `reservations.js` into controller/model → **Bloc 3**.
- Full MVC extraction of `devis.js` + `devis_*`/`reservation_*` table fusion + PDF service → **Bloc 4**.
  This spec only does the targeted devis offered fix (rule 18) and the DevisForm client adoption.
- Extending money validation to all write boundaries (devis, reservation create/update, resource
  bookings) → **Bloc S** (this spec only adds the util + applies it at `calculate-price`).
- `PageActionBar` migration for Calendar/Reservation pages → **Bloc 3**.
- **Visual source badges for iCal reservations** (in list/planning/calendar) → deferred; DB tag is
  enough for now (decided). This spec only guarantees the tag is preserved.
- New "platform real price" column distinct from `customPrice` → rejected; `customPrice` is reused.
- **"À payer plus tard" / per-extra payment tracking** → **its own spec** (Bloc 5 Finance). It needs
  new `paid` columns on `reservation_options` / `reservation_resources` / `reservation_custom_options`,
  plus careful interaction with deposit/balance to avoid double-counting. The "paid status per extra"
  model (option + resource subtotals, optionally tourist tax) is captured there. This Bloc 2 spec
  keeps the existing `offered` behavior only and does not add payment-status tracking.

## 9. Open questions

- Q: Should the effective-quantity for PlanningPage be a numeric field the client formats, or a fully
  pre-formatted label string from the server?
  - A (proposed): numeric field(s) on each line; PlanningPage renders "×N" from them with no math
    (pure string interpolation). Confirm during review.
- Q: Debounce delay — match ReservationPage's existing value exactly?
  - A (proposed): reuse whatever ReservationPage uses today (consolidated in the shared hook) so both
    pages behave identically.

**Resolved:**
- Manual price uses the existing `customPrice` column (no new column); the engine price is shown
  alongside as a reference/delta. ✅
- iCal identification: keep the existing DB tag; no visual badge in this spec. ✅
- The "Recalculer le prix" action lives in the finance section of the reservation form. ✅
