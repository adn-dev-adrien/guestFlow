# Platform commission line in the reservation summary

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-commission-line-in-summary` |
| **Created** | 2026-06-20 |
| **Author** | Adrien |

---

## 1. Context

For a **platform** reservation (Airbnb, Booking…) the operator enters the **gross** the guest paid the
platform (`clientGrossAmount`, FinanceSection « Prix payé par le client »). The platform keeps a
**commission**; the operator nets `finalPrice`. Today the commission is computed **client-side** in
FinanceSection and shown only there. The operator wants it in the **PricingSummary** (the right-side
recap) — and, per the fat-backend rule, **computed by the pricing engine**, not the client.

## 2. Goal

For a platform reservation with a known gross, the summary shows the deduction explicitly:

```
Total du séjour TTC (brut)   235,00 €
Commission plateforme       − 35,00 €
Net perçu TTC                200,00 €
```

The commission value is **engine-authoritative** (`quote.platformCommissionAmount`); the summary only
renders it.

## 3. Functional rules

1. **Commission = gross − net stay.** `platformCommissionAmount = max(0, clientGrossAmount − finalPrice)`,
   computed by the engine. Only for a **non-direct** platform with an operator-entered gross **above**
   the net; otherwise **0** (direct, no gross entered, gross ≤ net → no negative commission).
2. **Source = the operator-entered gross** (the existing « Prix payé par le client » field). The engine
   does the subtraction — no per-platform-% derivation here (that's the tarif-page feature).
3. **Summary display.** When `platformCommissionAmount > 0`, the « Total du séjour » block becomes three
   lines: **Total du séjour TTC (brut)** = `totalStayPrice + commission` (what the guest paid),
   **Commission plateforme** = `− commission`, **Net perçu TTC** = `totalStayPrice` (the net, unchanged).
   When it's 0, the single « Total du séjour TTC » line is shown exactly as before.
4. **Tax is a pass-through**, untouched by the commission: the tax sits in `totalStayPrice` on both the
   brut and the net (the commission applies to the stay only).
5. **Live recompute.** Changing the gross re-triggers the quote (the gross is in the quote signature),
   so the commission updates as the operator types.
6. **No persistence / no accounting change.** Display-only: the existing accounting commission
   (`gross − finalPrice` in `accountingModel`) is unchanged; nothing new is stored.

## 4. Architecture

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/pricing.js` | `pricing.js` | T | `calculateReservationQuote` accepts `clientGrossAmount`; returns `platformCommissionAmount = max(0, gross − finalPrice)` for non-direct platforms, else 0. |
| `controllers/reservationsController.js` | `reservationsController.js` | T | `calculatePrice` forwards `req.body.clientGrossAmount` to the engine. |

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/ReservationPage.js` | `ReservationPage.js` | T | Send `clientGrossAmount` in the `calculate-price` payload + add it to the quote signature (live recompute). |
| `components/PricingSummary.js` | `PricingSummary.js` | T | When `quote.platformCommissionAmount > 0`, render the brut / commission / net block; else the single total line. |

### 4.3 API

`POST /api/reservations/calculate-price` accepts `clientGrossAmount`; the response gains
`platformCommissionAmount`.

## 5. Data model

No change. Uses the existing `reservations.clientGrossAmount` (operator-entered gross).

## 6. UI / UX

- Platform reservation, gross > net → the 3-line block (brut / − commission / net perçu); the commission
  is `warning`-coloured, the net is the primary headline.
- Direct, or no/low gross → unchanged single « Total du séjour TTC » line.
- Responsive: the rows are the same `space-between` layout as the rest of the summary.

## 7. Test plan

### Server
- [x] `pricing-platform-commission.unit.test.js` (4) — platform gross > net → commission = gross − net;
  direct → 0; no gross → 0; gross ≤ net → 0.

### Client (vitest)
- [x] `PricingSummary.commission.test.js` (2) — commission > 0 → brut / « Commission plateforme » /
  « Net perçu TTC » lines; commission 0 → the plain single total line.

## 8. Out of scope

- Deriving the gross from the platform's commission % (the tarif-page feature; here the gross is
  operator-entered).
- Any accounting/persistence change (display-only).
- Showing the commission on direct bookings (commission = 0 by definition).

## 9. Open questions

Resolved during scoping (questionnaire): commission source = operator-entered gross − net; display =
« brut − commission = net perçu ».
