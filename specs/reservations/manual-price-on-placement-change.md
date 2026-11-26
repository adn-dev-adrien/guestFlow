# Manual price review on a placement change

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/manual-price-on-placement-change` |
| **Created** | 2026-11-23 |
| **Author** | Adrien |
| **Related PR** | — |
| **Summary for validation** | `docs/specs/2026-11-23-manual-price-on-placement-change.html` |

---

## 1. Context

A reservation (or devis) can carry a **manual accommodation price** — the « Prix ajusté » field of the Finance
section, stored as `customPrice`. The engine then ignores its own nights total (`totalPrice`) and charges that
figure instead (`server/src/utils/pricing/discounts.js` `allocateDiscount`).

When the operator **moves** the booking — new dates through the date fields or the mini-calendar strip, or another
logement — the fiche drops its price lock and re-prices at the new placement
(`ReservationPage.jsx` `isExistingReservationPricingLocked`, specs/devis/devis-extras-parity-and-price-lock.md rule 13).
But `applyQuoteToForm` keeps `customPrice` untouched, so the final price stays exactly what was typed for the
**old** placement. Extending a stay from 3 to 5 nights keeps it at 350 € while the tariff went from 400 € to 650 €;
nothing on screen says so, and the save stores it.

A manual price is a decision taken against a given tariff. Once that tariff changes, the decision has to be taken
again — by the operator, with the figures in front of them.

## 2. Goal

When a move changes the tariff of a booking that has a manual price, the fiche shows what changed and why, and the
operator chooses: keep the manual price, keep the same gap to the new tariff, or go back to the tariff.

## 3. Functional rules

### 3.1 When the review opens

1. The review opens when **all** of these hold, judged by the server on the live quote:
   - the booking has a manual price (`customPrice` non-empty);
   - its **placement** differs from the placement the manual price was decided against — another `propertyId`,
     `startDate` or `endDate` (rule 4);
   - the engine's nights total at the new placement (`totalPrice`) differs from the **reference tariff** (rule 4)
     by at least 0,01 €.
2. It opens **as soon as the quote of the new placement comes back**, not at save. A partial date selection (start
   picked on the strip, end not yet) never opens it: the review is only computed on a complete, valid range.
3. It never opens for:
   - a platform sale (the « Prix ajusté » card is hidden: `isPlatform`, the brut is the single price lever);
   - a stay that has started (its price is frozen; an unlocked fiche keeps its final price —
     specs/settings/settings-rationalization.md rule 35, D21);
   - a change of anything other than the placement (occupants, options, discount): those already re-price live
     and the manual price is the operator's explicit input next to them.

### 3.2 The reference

4. The **reference** is the pair (placement, tariff) the manual price was last decided against:
   - on a saved reservation or devis: the stored placement and the stored `totalPrice`;
   - when the operator types a manual price: the current placement and the quote's `totalPrice` at that moment;
   - after a review is answered: the new placement and the new `totalPrice` — moving again re-opens the review
     only if the tariff changes again (rule 1).
   The client keeps only the reference **placement** as local UI state and sends it with the quote (§4.3). The
   server prices it itself — replaying the booking's stored tariff snapshot when the reference is the stored
   placement, so the reference tariff equals the stored `totalPrice` — and owns the comparison. No amount comes
   from the client.
5. The **gap** is `customPrice − reference tariff`, signed, rounded to the cent (−50,00 € = a reduction of 50 €).

### 3.3 What the review shows

6. **The tariff change:** reference tariff → new tariff, with the difference.
7. **Why it changed**, from the engine's nightly breakdowns: nights count before → after, then the nights grouped by
   season label (`seasonLabel`) with their count and amount, before and after. When the reference has no stored
   breakdown (legacy row, no tariff snapshot), only the totals and the nights count are shown.
8. **The current manual price** and its gap to the reference tariff (rule 5).
9. **Three choices**, each with the resulting accommodation price and the resulting **total séjour** (accommodation
   + options + tourist tax, as the engine computes it for that price):
   - **Garder le prix ajusté** — `customPrice` unchanged;
   - **Garder l'écart** — `customPrice = new tariff + gap`;
   - **Appliquer le tarif** — `customPrice` cleared; the engine price applies.
10. **Garder l'écart** is not offered when it would not be a distinct choice:
    - gap = 0 (the manual price equalled the tariff): it equals « Appliquer le tarif », so only two choices remain;
    - new tariff + gap < 0: the choice is shown disabled with « Écart supérieur au nouveau tarif ».
11. All figures — gap, the three prices, the three totals, the grouped breakdowns — come from the server. The
    client renders them.

### 3.4 Answering

12. **Appliquer** applies the selected choice to the form (`customPrice`) and moves the reference (rule 4). Nothing
    is saved: the fiche becomes dirty and « Enregistrer » stores it as any other edit.
13. **Annuler le changement** puts the previous placement back (dates and logement as before the move) and closes
    the review; the manual price is untouched.
14. Escape and a click outside the dialog act like **Annuler le changement**: the review never ends silently on a
    price nobody chose.
15. The preselected choice is **Garder l'écart** — the usual intent when a stay with a reduction is moved or
    extended. When it is absent (gap = 0) or disabled (rule 10), **Garder le prix ajusté** is preselected.
16. No save stores a manual price the operator has not reviewed: while the quote of a move is in flight the save
    button shows busy and a click does nothing; a review held back by an incomplete strip selection (rule 2) opens
    on « Enregistrer » instead of saving. Once open, the review is modal.

**Edge cases:**
- Two moves in a row before answering (impossible: the review is modal) → n/a.
- Move, answer « Garder le prix ajusté », move back to the original dates → the tariff differs from the reference
  (now the moved tariff) → the review opens again, showing the way back.
- New reservation, no manual price → never opens.
- Devis with a valid price lock moved to new dates → same review (the lock already drops on a placement change).
- Acompte already paid and the chosen price lowers the total below what was collected → the ledger's existing
  trop-perçu handling applies after save; the review does not duplicate it.
- The engine returns no price for the new placement (closure, missing season) → the existing quote error shows;
  no review.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `manualPriceReview.js` | C | Pure: `buildManualPriceReview({ reference, placement, customPrice, quote, evaluate })` → review or `null`. Trigger rules 1-3, gap, choices with their prices and totals (via `evaluate(customPrice)`), season grouping of both breakdowns, rule 10. |
| `controllers/` | `reservationsController.js` | T | Live quote: reads `customPriceReference`, prices the reference placement (with the stored snapshot when it is the stored placement), attaches `quote.manualPriceReview`; totals per choice via the existing `evaluate(customPrice)` pattern and `stayGross`. Started-stay and platform exclusions use the existing helpers (`hasStayStarted`, `isPlatform`). |
| `routes/` | — | — | (none — same quote endpoint) |
| `models/` | — | — | (none — `getPricingSnapshot` already exposes the stored breakdown) |
| `middleware/`, `database.js`, `scheduledTasks.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Holds the reference (rule 4) and the previous placement; sends `customPriceReference` with the quote; opens the dialog when `manualPriceReview` comes back; applies the choice or restores the placement. |
| `components/` | `ChoiceDialog.jsx` | C | **Generic**: a modal « pick one of N » with an intro slot, radio cards (label, figure, caption, disabled reason) and confirm / cancel. Built on `FormDialog`. |
| `components/reservation/` | `ManualPriceReviewContent.jsx` | C | **Specific**: renders the review's explanation (tariff change, nights, season groups, current gap). |
| `utils/` | `applyQuoteToForm.js` | — | (unchanged: it keeps preserving `customPrice`; the review decides what that value is) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog` | fullScreen under `sm`, stacked actions, reduced-motion aware. |
| **Created (new generic)** | `ChoiceDialog` | « Choose one of N consequences » recurs: the solde/acompte reallocation, the iCal conflict resolution, the VAT regime switch all ask the operator to pick one outcome with its figure. |
| **Specific (kept feature-local)** | `ManualPriceReviewContent` | Its content is the tariff explanation of this feature only. |

### 4.3 API contract

| Method | Endpoint | Request body (added) | Response (added) |
|---|---|---|---|
| POST | `/api/reservations/calculate-price` (live quote, existing) | `customPriceReference?: { propertyId, startDate, endDate }` | `manualPriceReview: null \| Review` |

```
Review = {
  reference:   { startDate, endDate, propertyName, nights, totalPrice, seasons: [{ label, nights, amount }] | null },
  placement:   { startDate, endDate, propertyName, nights, totalPrice, seasons: [{ label, nights, amount }] },
  tariffDelta: number,             // placement.totalPrice − reference.totalPrice
  customPrice: number,
  gap:         number,             // rule 5
  choices: [
    { key: 'keep',    customPrice: number,       finalPrice, totalStay },
    { key: 'keepGap', customPrice: number,       finalPrice, totalStay, disabledReason?: string },  // absent when gap = 0
    { key: 'engine',  customPrice: '' ,          finalPrice, totalStay },
  ],
}
```

Absent `customPriceReference` → `manualPriceReview: null` (backward compatible for every other caller). Same auth
as the quote endpoint.

---

## 5. Data model

None. The reference is UI state; the stored `totalPrice` and tariff snapshot already exist.

## 6. UI / UX

Dialog « Tarif modifié » (`ChoiceDialog`), opened over the fiche — see the interactive mockup in
`docs/specs/2026-11-23-manual-price-on-placement-change.html`.

- **Explanation block** (top): « Tarif hébergement 400,00 € → 650,00 € (+250,00 €) », « 3 nuits → 5 nuits », then
  a two-column « Avant / Après » list of season groups (« Moyenne · 3 nuits · 400,00 € »). Below:
  « Prix ajusté : 350,00 € (−50,00 € sur le tarif) ».
- **Choices** (radio cards, vertical): label, price in bold tabular figures, caption with the total séjour.
  - « Garder le prix ajusté » — 350,00 € — « Total séjour 412,40 € »
  - « Garder l'écart » — 600,00 € — « 650,00 € − 50,00 € · Total séjour 662,40 € »
  - « Appliquer le tarif » — 650,00 € — « Prix ajusté retiré · Total séjour 712,40 € »
- **Actions:** « Annuler le changement » (secondary) · « Appliquer » (primary).
- Copy is impersonal and short (no « vous »/« tu », no engine mechanics).
- **Responsive:** `md+` dialog `maxWidth="sm"`, Avant/Après side by side. `xs` fullScreen, Avant/Après stacked,
  choice cards full width, actions stacked full width, primary last, 44 px high.
- **Motion:** MUI default dialog transition, none under `prefers-reduced-motion` (FormDialog already does it).
- **PageActionBar:** unchanged; the dialog is modal over it.

## 7. Test plan

### Server unit tests — 10 tests
- [x] `server/src/tests/manual-price-on-placement-change.unit.test.js` — `buildManualPriceReview`:
  - rule 1: no manual price / same placement / same tariff → `null`; dates moved with a tariff change → review;
  - rule 3: platform sale and started stay → `null`;
  - rule 5: gap sign and rounding (reduction and increase);
  - rule 9: the three prices and totals come from `evaluate`;
  - rule 10: gap 0 → two choices; negative result → `disabledReason`;
  - rule 7: season grouping before/after; reference without breakdown → `seasons: null`.
- [x] Controller-level (same file): `null` without `customPriceReference`; review on a stored stay extended by 2 nights;
  the stored placement replays the stored tariff (rule 4); a started stay gets none.

### Client tests — 8 tests
- [x] `client/src/components/__tests__/ChoiceDialog.test.jsx` (4) — preselection and fallback, disabled choice, confirm, cancel + Escape.
- [x] `client/src/pages/__tests__/ReservationPage.manual-price-review.test.jsx` (4) — reference sent with the move; « Garder
  l'écart » preselected and applied; « Annuler le changement » restores the dates; a save during the move's quote stores nothing (rule 16).
- [x] `ReservationPage.fiche-busy-invariant.test.jsx` — the review's handlers classified (local draft edit).

### Manual UI verification (2026-11-23, headless Chromium on a copy of the dev DB)
- [x] Happy path: 3 nights at 270 € (tariff 300 €) extended to 5 nights → review 300 → 500 €, « Garder l'écart » preselected,
  applied → 470 €; no review re-opens.
- [x] Escape restores the previous dates and keeps 270 €.
- [x] « Appliquer le tarif » clears the manual price; a later move without a manual price opens no review.
- [x] Mobile 390 px: fullScreen dialog, Avant/Après stacked, actions stacked full width.
- [x] E2E suite: 224 passed. Server suite 14 862 passed, client suite green.

## 8. Out of scope

- Reviewing the manual price when occupants, options or the discount change.
- Platform sales (the brut is reviewed by the platform-statement flows).
- Re-pricing an expired devis reopened at its own dates (no move).
- A planning drag-and-drop (none exists today; it would reuse the same review).

## 9. Open questions

- Q: Which choices? — A (2026-11-23): three — keep the manual price, keep the gap in euros, apply the tariff.
- Q: When does the review open? — A (2026-11-23): as soon as the new placement's quote comes back.
- Q: Preselected choice? — A (2026-11-23): « Garder l'écart », falling back to « Garder le prix ajusté » (rule 15).
- Q: Escape / click outside? — A (2026-11-23): « Annuler le changement » (rule 14).
