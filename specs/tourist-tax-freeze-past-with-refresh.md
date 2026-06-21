# Tourist tax — freeze past reservations, manual refresh button

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/tourist-tax-freeze-past-with-refresh` |
| **Created** | 2026-06-20 |
| **Author** | Adrien |

---

## 1. Context

The tourist tax shown on the reservation fiche is **recomputed live** by the engine on every quote
(current property tax settings). For a **percentage-of-accommodation** tax, this means a later change
to the commune rate (or the nightly price) silently changes the tax on **already-past** reservations —
including stays of months that have already been **declared to the commune** (via *Suivi taxe de
séjour*) and exported to *Comptabilité*. That must not happen: a past month's tax must stay exactly
what was declared.

Conversely, **upcoming** reservations *should* keep tracking the current settings (a rate change
applies to future stays).

## 2. Goal

- **Past reservations**: the tourist tax is **frozen** — the fiche (and therefore the quote feeding
  the books) shows the **stored** amount, never a live recompute.
- **Current/future reservations**: unchanged — the tax recomputes live with the current settings.
- **Manual override**: next to the « Taxe de séjour » summary line, a **refresh button** (shown only
  for a *past* reservation) **forces a recompute** of the tourist tax. The recomputed amount replaces
  the frozen one and marks the form dirty, so **saving** persists the new value (which then flows to
  the books). Nothing is persisted until the operator saves.

## 3. Functional rules

1. **« Past » boundary.** A reservation is *past* (→ frozen) when its **last night**
   (`endDate − 1 day`) is **before the 1st day of the current month**. Current-month and future stays
   are *not* frozen (live recompute, as today).
2. **Freeze = use the stored amount.** When frozen, the quote returns the reservation's **stored**
   `touristTaxTotal` / `touristTaxRate` (and `touristTaxOriginalTotal = stored total`) instead of
   recomputing them. The **routing** of the tax (offered / balance / complement, driven by the
   platform's global mode) is unchanged — only the **amount** is frozen.
3. **Refresh button.** Rendered in the `PricingSummary` tourist-tax block, **only for a past
   reservation**. Clicking it sets a local `touristTaxRefreshRequested` flag → the next quote is
   computed **unfrozen** → the recomputed tax replaces the frozen amount → the form becomes dirty.
   The operator then **saves** to persist (the button never auto-saves). The flag resets when the
   reservation is reloaded.
4. **No retroactive write.** Freezing/refresh only affects the live quote + (on refresh+save) the
   stored amount. The *Comptabilité* keeps using the **stored** `touristTaxTotal` (per
   per-platform-tourist-tax-three-way.md), so a frozen past reservation's books are untouched until
   the operator explicitly refreshes **and** saves.
5. **Future reservations** keep the current live-recompute behaviour (no button shown).

**Edge cases**
- A reservation with no stored tax (e.g. an old import) that is *past* → frozen at `0`; the refresh
  button lets the operator pull the computed value in.
- Switching a reservation's dates from past to future (rare edit) → it stops being frozen (live again).

## 4. Architecture

> **Fat backend.** The freeze decision value (`freezeTouristTax`) is computed on the client (it knows
> the dates + the refresh state), but the **frozen amount is sourced server-side** from the stored
> reservation, and the engine is the single place that returns either the frozen or the live tax — so
> `PricingSummary` stays dumb (it always renders `quote`).

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/pricing.js` | `pricing.js` | T | `calculateReservationQuote` accepts `freezeTouristTax` + `frozenTouristTaxTotal` + `frozenTouristTaxRate`. When `freezeTouristTax` is true, `touristTaxTotal` / `touristTaxOriginalTotal` / `touristTaxRate` are taken from the frozen inputs (not `computeTouristTaxBreakdown`); the offered/arrival/balance routing still applies to that amount. |
| `controllers/reservationsController.js` | `reservationsController.js` | T | `calculatePrice`: when `req.body.freezeTouristTax` is truthy and a `reservationId` is given, read the stored `touristTaxTotal` / `touristTaxRate` from the reservation and pass them as the frozen inputs. |

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/ReservationPage.js` | `ReservationPage.js` | T | Compute `isPastReservation` (last night < 1st of current month). Hold `touristTaxRefreshRequested` state. Pass `freezeTouristTax = isPastReservation && !touristTaxRefreshRequested` into `api.calculatePrice` (added to the quote signature so a refresh re-triggers a recompute). Pass `isPastReservation` + an `onRefreshTouristTax` callback to `PricingSummary`. **Bugfix 2026-06-21:** `freezeTouristTax` must also be in the `pricingQuoteSignature` useMemo **dependency array** — it was in the signature object but missing from the deps, so the memo stayed stale on a refresh, the live-preview effect never re-fired, and the tax only recomputed after a save. The « Recalculer » button now recomputes live on the unsaved form amounts. |
| `components/PricingSummary.js` | `PricingSummary.js` | T | Render a small refresh `IconButton` (tooltip « Recalculer la taxe de séjour ») next to the « Taxe de séjour » label, **only when `isPastReservation`**. Calls `onRefreshTouristTax`. |
| `api.js` | `api.js` | T | `calculatePrice` already forwards the whole body; add `freezeTouristTax` to the payload it sends. |

### 4.3 API

`POST /api/reservations/calculate-price` gains an optional `freezeTouristTax: boolean`. When true with
a `reservationId`, the response's `touristTaxTotal` / `touristTaxRate` / `touristTaxOriginalTotal`
reflect the **stored** amount.

## 5. Data model

No schema change. Uses the existing `reservations.touristTaxTotal` / `touristTaxRate` as the frozen
source.

## 6. UI / UX

- The « Taxe de séjour » summary line gains a discreet **refresh icon** to its right, **only for a
  past reservation**. Tooltip: « Recalculer la taxe de séjour (séjour passé — figée) ». Clicking it
  recomputes the tax; the value updates and the page becomes dirty (Save appears).
- Future/current reservations: no icon, behaviour unchanged.
- Responsive: the icon sits inline with the label; ≥44px touch target.

## 7. Test plan

### Server
- [x] `pricing-tourist-tax-freeze.unit.test.js` (4) — `calculateReservationQuote` with
  `freezeTouristTax` pins the frozen total/rate (not the recompute); without it, recomputes
  (regression); routing (direct → balance/total) still applies to the frozen amount; a 0 stored
  amount pins 0.
- [~] `reservationsController.calculatePrice` wiring (read the stored `touristTaxTotal`/`Rate` for a
  `reservationId` when `freezeTouristTax`) — trivial pass-through, covered by inspection + the engine
  test (the controller test harness stubs the whole DB stack; not worth a dedicated case here).

### Client (vitest — 558 pass)
- [x] `PricingSummary.tourist-tax.test.js` (extended) — the refresh icon renders only when
  `isPastReservation`; clicking calls `onRefreshTouristTax`; absent otherwise.

### Manual
- [ ] Past reservation: change the property tourist-tax %, reopen → tax unchanged (frozen). Click
  refresh → tax updates → Save → books reflect it.
- [ ] Future reservation: change the % → tax tracks live, no icon.

## 8. Out of scope

- Auto-recompute of past reservations in Comptabilité/Suivi (explicitly NOT wanted — only the manual
  refresh+save path updates a past reservation).
- A bulk "refresh all" action.

## 9. Open questions

- **Boundary date** = stay's last night vs the payment/declaration date — assumed **stay last night
  < 1st of current month** (to confirm).
