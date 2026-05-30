# Extract PricingSummary from ReservationPage

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/pricing-summary-extraction` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc 3 — Réservations & Calendar, slice **3c-2**. See `specs/ROADMAP.md`. |

---

## 1. Context

`ReservationPage.js` (~3200 LOC) renders the right-hand **pricing summary** inline (~lines 2699-3225,
≈525 LOC): accommodation price (engine struck / manual green), options & resources lines (each with an
"Offrir" toggle), extra-guest surcharge, tourist tax (with detail + offered-by-platform note), VAT
breakdown (expandable), stay total TTC, deposit, balance and caution. It also owns three pure display
toggles (`showNightlyBreakdown`, `showVatDetail`, `showTouristTaxDetail`).

This was the `PricingSummary` flagged for extraction in Bloc 2. The original multi-page reuse rationale
has since evaporated (CalendarPage's reservation dialog and `DevisForm` proved dead — devis use
ReservationPage). So this extraction's value is now **ReservationPage readability** (shrinking the
monolith), not multi-page reuse; the component is still designed cleanly in case a future booking
surface needs it.

## 2. Goal

Move the pricing-summary rendering into a focused `client/src/components/PricingSummary.js`, leaving
ReservationPage to pass data + offer callbacks. No behavior or visual change.

## 3. Functional rules

1. **Behavior-preserving & pixel-identical.** The summary renders exactly as today (same fields, order,
   struck/green accommodation price, offered strikethroughs, tourist-tax/VAT detail expanders, totals,
   deposit/balance/caution, all French copy). No logic change.
2. **Component is presentational + local UI state only.** `PricingSummary` receives the server `quote`
   and the inputs it needs to render, plus offer callbacks; it owns the three display toggles
   (`showNightlyBreakdown`, `showVatDetail`, `showTouristTaxDetail`) as internal state (they are pure
   UI, used only here). No business calculation in the component (it renders server-computed values).
3. **Offer toggles via callbacks.** The "Offrir" actions stay authoritative on the page: the component
   calls props `onToggleExtraGuestOffered()`, `onToggleOptionOffered(optionId)`,
   `onToggleCustomOptionOffered(customKey)`, `onToggleResourceOffered(resourceId, nextOffered)`. The page
   wires these to its existing handlers (`updateForm`, `setOfferedOptionIds`, `updateCustomOption`,
   `setResourceOffered`) — unchanged behavior.
4. **Inputs passed as props** (read-only): the `quote` (pricingQuote), `form` (or the specific fields it
   reads: customPrice, depositAmount/DueDate/Paid, balanceAmount/DueDate/Paid, cautionAmount/Received/
   Returned + dates, platform, extraGuestSurchargeOffered), `nightlyBreakdown`, `offeredOptionIds`,
   `propertyOptions`, `availableResources`, `isIcalSource`, `selectedProperty`, and the few display
   helpers currently computed in the page (`parsedTotalPrice`, `accommodationBasePriceDisplay`,
   `accommodationDiscountedPriceDisplay`) — passed in so the values are identical.
5. **No new behavior, no removed feature.** Locked-reservation styling, devis vs reservation differences
   visible in the summary, and the iCal "collected by platform" tourist-tax note all behave as before.
6. **ReservationPage shrinks** by ~500 LOC; the moved toggle state declarations are removed from it.

**Edge cases:** all current ones preserved (no quote yet → empty/0 rendering; offered line shows struck
original price; custom option offered; per-hour resource "1ère heure offerte"; tourist tax offered by
non-direct platform / iCal). Pure move.

---

## 4. Architecture

> Client-only presentational extraction. Fat backend untouched; the component only renders the
> server `quote` and lifts interaction back to the page via callbacks.

### 4.1 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `PricingSummary.js` | C | Presentational summary: renders the quote (accommodation struck/green, options/resources with Offrir, extra-guest, tourist tax + detail, VAT detail, total, deposit/balance/caution). Owns the 3 display toggles internally. JSDoc lists props. |
| `pages/` | `ReservationPage.js` | T | Replace the inline summary JSX (~2699-3225) with `<PricingSummary … />`; remove the 3 toggle `useState`s; pass data + offer callbacks. Remove now-unused imports if any. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI primitives already used | — |
| **Created (new generic)** | `PricingSummary` | Presentational; the only live consumer today is ReservationPage, but it's cleanly designed for any future booking/quote surface (the original Bloc-2 intent). |

No server, API, or data changes.

### 4.2 API contract

Unchanged.

---

## 5. Data model

No changes.

## 6. UI / UX

No visible change — the right-hand pricing summary looks and behaves identically. Responsive behavior
unchanged (it already stacks below the form on `xs`, sticky on `md+`). The component keeps the existing
sticky panel wrapper styling (or the page keeps the wrapper and renders `<PricingSummary>` inside — to
be decided in implementation, whichever preserves the current layout exactly).

**Sticky scroll trap (md+, added 2026-05-30):** when the summary content overflows the viewport,
the panel becomes its own scroll area so the wheel/trackpad scrolls **inside** the panel rather than
the page when the cursor sits over it. Implemented on the root `<Box>` of `PricingSummary` with
`maxHeight: { md: 'calc(100vh - 148px - 16px)' }` (148 px sticky top + 16 px breathing room),
`overflowY: { md: 'auto' }`, and `overscrollBehavior: 'contain'` to keep the inner scroll independent.
The `xs` flow is untouched (page-natural scroll). Verified mechanically: `panel.scrollTop = 200`
moves the panel while `window.scrollY` stays at 0.

## 7. Test plan

### Server unit tests
- [ ] N/A (client-only). Existing server suite stays green.

### Manual UI verification
- [ ] Reservation: summary shows accommodation price, options/resources, tourist tax, VAT, total,
      deposit/balance/caution identical to before.
- [ ] Manual price: engine price struck + manual price green (unchanged).
- [ ] "Offrir" an option/resource/extra-guest → line struck + 0, total updates; un-offer restores
      (callbacks intact).
- [ ] Expand "Détail" (nightly), tourist-tax detail, VAT detail → work (internal toggles).
- [ ] Devis mode (`?mode=devis`) summary renders correctly; iCal reservation shows "Collectée par la
      plateforme" note.
- [ ] `0` console errors; clean `CI=true` build (no unused/undef).
- [ ] Mobile (`xs`): summary stacks below the form, renders correctly.

## 8. Out of scope

- Splitting the rest of the form into section components → slice **3c-3**.
- `reservationConflicts` server consolidation → slice **3c-4**.
- Any pricing logic change (owned by the server quote).

## 9. Open questions

- Q: Keep the sticky panel wrapper in ReservationPage and put only the card contents in `PricingSummary`,
  or move the whole sticky wrapper into the component? — A (proposed): move the whole right-panel
  (wrapper + card) into `PricingSummary` so the page just renders `<PricingSummary>` in the grid;
  preserve the exact sticky sx. Confirm during review.
