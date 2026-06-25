# Timed auto-options — proportional early check-in / late check-out pricing

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/timed-options-reprice-on-time-change` _(user-managed)_ |
| **Created** | 2026-06-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow has two **auto-timed options** — *arrivée anticipée* (`early_check_in`) and *départ tardif*
(`late_check_out`). They are not selected by hand: the engine adds them automatically when the
reservation's `checkInTime` is earlier than the property's `defaultCheckIn` (resp. `checkOutTime` later
than `defaultCheckOut`), and prices them from **how far** the requested time is from the default. The
feature predates the spec-driven workflow (original commit *"enable early checkin out"*), so this spec is
written **retroactively** to document the rules and to anchor a bug fix.

**The bug that prompted this spec:** on an **already-created** reservation, changing the arrival time did
**not** reprice the option. Concretely: a booking where the early check-in had been *offered* (= one full
extra night) had its arrival moved from 10:00 to 11:30, but the option amount never changed; even after
removing the *offert* flag, the early-check-in price stayed frozen. The live price preview (client) showed
the new amount, but the **save persisted the old one**.

**Root cause:** on update an existing reservation reuses its *locked pricing snapshot*
(`canReuseLockedPricing` → `getPricingSnapshot`). For auto-timed options the engine recomputed the price
from the new time and then **immediately overwrote it with the locked snapshot value**
(`mergeLineWithLockedSnapshot`, same billed-unit count → returns the locked total). The reference night
price is *already* frozen upstream (the locked nightly breakdown), so re-overwriting the option froze the
time-driven part too — wrongly.

## 2. Goal

The proportional price of an auto-timed option always reflects the **current** check-in / check-out time,
on a fresh quote and on an edit of a saved reservation alike. Locking protects the **night rate**, not the
time-driven surcharge.

## 3. Functional rules

Auto-timed option config (per option, in the `options` catalog):
- `autoOptionType` ∈ `early_check_in | late_check_out` — marks the option as auto-timed.
- `autoEnabled` (0/1) — when 0 the option is never auto-added.
- `autoPricingMode` ∈ `fixed | proportional` — `fixed` bills the option's flat `price`; `proportional`
  bills a fraction of a reference night (rules 3-5).
- `autoFullNightThreshold` (HH:MM) — the time at/under which (early) or at/over which (late) a **full**
  reference night is billed. Defaults: `10:00` (early), `17:00` (late).

1. **Auto-add condition.** The option is added only when the requested time crosses the default:
   early → `checkInTime < defaultCheckIn`; late → `checkOutTime > defaultCheckOut`. Otherwise no line.
2. **Reference night.** Early check-in uses the **first** night of the stay; late check-out uses the
   night **following** the departure date (`getLateCheckoutNextNightReferencePrice`), falling back to the
   last stay night. Never the whole-stay total.
3. **Full-night band.** If the requested time is at/beyond the threshold (early: `≤ threshold`; late:
   `≥ threshold`) the option bills **one full reference night**.
4. **Proportional band.** Between the default and the threshold the option bills
   `referenceNight × ratio`, where `ratio = extraHours / windowHours`, clamped to `[0, 1]`:
   - early: `extraHours = defaultCheckIn − checkInTime`, `windowHours = defaultCheckIn − threshold`.
   - late: `extraHours = checkOutTime − defaultCheckOut`, `windowHours = threshold − defaultCheckOut`.
5. **Fixed mode.** `autoPricingMode = 'fixed'` ignores rules 3-4 and bills the flat `option.price`.
6. **Reprice on time change — even on a locked reservation.** The proportional amount is **always
   recomputed** from the current `checkInTime` / `checkOutTime` on every quote, including the update of a
   saved reservation that carries a locked snapshot. The locked snapshot freezes the **night rate**
   (via the locked nightly breakdown that feeds the reference night), so recomputing the option yields
   *"locked reference night × ratio(current time)"*. The auto-timed option line is **not** passed through
   `mergeLineWithLockedSnapshot` (that freeze was the bug). Only the option's **routing flags**
   (`inComplement` / `acompteContribTtc` / `soldeContribTtc`) still fall back to the locked snapshot.
7. **Offered interaction.** When the option is *offered* the billed `totalPrice` is 0 but
   `originalTotalPrice` holds the real value; rule 6 applies to that real value — changing the time
   reprices `originalTotalPrice`, and removing *offert* then bills the freshly-computed amount.

## 4. Architecture

> **Fat backend.** The pricing engine owns the calculation; the client only renders the quote and
> re-requests one when an input (incl. the times) changes.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `pricing.js` | C | `computeAutoTimedOptionContext` computes the proportional/full-night amount from the times + reference night (unchanged). In `calculateReservationQuote`, the auto-option mapping **no longer merges the line with the locked option snapshot** — it uses the freshly-computed `totalPrice` (rule 6) and only reads routing flags from the locked snapshot. |
| `controllers/` | `reservationsController.js` | — | Unchanged. Still reuses the locked snapshot on update (`canReuseLockedPricing`) — which now correctly only freezes the night rate, not the time surcharge. |

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | — | Unchanged. `pricingQuoteSignature` already includes `checkInTime` / `checkOutTime`, so the live preview re-quotes on a time change; this fix makes the **persisted** price match what the preview shows. |

## 5. Data model

No schema change. The `options` columns (`autoOptionType`, `autoEnabled`, `autoPricingMode`,
`autoFullNightThreshold`) and the locked-pricing snapshot already exist.

## 6. UI / UX

No UI change. Observable effect: on a saved reservation, changing the arrival/departure time now updates
the early-check-in / late-check-out amount on save (matching the live preview) instead of keeping the old
amount. Offered options update their underlying value too. Identical on mobile and desktop.

## 7. Test plan

### Server unit tests (`pricing-auto-options.unit.test.js`)
- [x] Existing: proportional early check-in with extra hours; no line at default hours; late check-out
      next-night reference; full-night threshold.
- [x] **New (rule 6):** a locked reservation re-quoted at a different arrival time reprices the option to
      the new time (not frozen at the locked amount).
- [x] **New (rule 7):** an **offered** locked early check-in reprices its `originalTotalPrice` on a time
      change while the billed total stays 0.
- Full server suite green (1837 pass).

## 8. Out of scope

- Changing the proportional formula / thresholds themselves (documented as-is).
- Repricing the locked **night rate** on edit (that stays frozen by design — the "use current pricing"
  flow is the explicit way to refresh it).

## 9. Open questions

- (Resolved 2026-06-25) On a locked reservation, the time-driven auto-option surcharge **recomputes**;
  only the night rate stays frozen.
