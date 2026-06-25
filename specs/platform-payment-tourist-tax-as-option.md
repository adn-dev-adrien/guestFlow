# Platform payment — count the reversed tourist tax as part of the brut (no phantom écart)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/platform-payment-tourist-tax-as-option` _(user-managed)_ |
| **Created** | 2026-06-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

For a **platform_reversed** booking (the platform collects the tourist tax from the guest, then
reverses it to us, and **we** remit it to the commune — `collectsTouristTax = 1`,
`touristTaxRemittedByPlatform = 0`), the operator enters the **brut** (« Montant total payé par le
client ») in the « Paiement plateforme » block. That brut is what the guest actually paid the
platform — so it **already includes the tourist tax**.

The pricing engine ([pricing.js](../server/src/utils/pricing.js) ~L1451-1470) back-solves the
accommodation from the brut as `accommodation = brut − extra-guest − pre-arrival options/resources`
— **without** subtracting the tax. The tax therefore gets **baked into the accommodation**, and then
`totalStayPrice = finalPrice + touristTaxTotal` **adds it a second time**. The tax is double-counted.

Confirmed numerically (2 adults × 2 nights × 1.20 €/night = 4.80 € tax; brut = 204.80 € = 200 accom
+ 4.80 tax; commission 20 €):

| Quantity | Today (buggy) | Expected |
|---|---|---|
| `finalPrice` | 204.80 | 200.00 |
| `totalStayPrice` | 209.60 | 204.80 |
| `balanceAmount` | 209.60 | 204.80 |
| `platformNetReceivedAmount` | 189.60 | 184.80 |
| virement reçu (brut − commission) | 184.80 | 184.80 |
| **écart (net perçu − virement)** | **+4.80 (= the tax)** | **0.00** |

So the « Paiement plateforme » reconciliation **always shows an écart equal to the tourist tax**, and
the balance / total séjour are over-stated by the tax.

## 2. Goal

When the tourist tax is collected by the platform then reversed to us, the platform-payment
calculation must **count that tax as part of the brut** (like a pre-arrival option already included
in the amount the guest paid) — so the accommodation, total de séjour, balance, and « Net perçu »
no longer double-count it, and the écart against the virement is 0.

## 3. Functional rules

1. The rule applies **only** to a non-direct reservation **with a brut entered**
   (`platformGrossAmount` set) **and** a reversed-by-platform tourist tax — i.e.
   `collectsTouristTax = 1` **and** `touristTaxRemittedByPlatform = 0` **and** `touristTaxTotal > 0`
   (the existing `touristTaxReversedByPlatform` case 1).
2. In that case, the brut→accommodation back-solve subtracts the reversed tourist tax as if it were a
   pre-arrival option included in the brut:
   `accommodation = max(0, brut − extra-guest − pre-arrival options/resources − reversedTouristTax)`.
3. As a consequence (no new code, mechanical): `finalPrice` excludes the tax,
   `totalStayPrice = finalPrice + tax = brut`, `preArrivalAmount = brut`, the platform balance = brut,
   `platformNetReceivedAmount = brut − commission`, and the écart against `platformPayoutAmount`
   (= brut − commission) is 0.
4. **No behaviour change** for any other case: direct bookings, platform-offered tax (case 2,
   `touristTaxTotal = 0`), owner-collect tax (case 3, tax on the complement), a platform_reversed
   booking with **no brut entered**, or any reservation without a tourist tax. The tax **amount**
   itself is unchanged in every case (only where it lands in the brut split changes).

**Edge cases:**
- Brut smaller than options + tax → accommodation clamps at 0 (existing `max(0, …)` guard).
- Percentage-mode tourist tax (`touristTaxPercentage > 0`) on a brut-pinned platform_reversed
  booking: the tax **amount** is still computed on the same accommodation base as today (so existing
  amounts never move); only the brut split subtracts it. Any second-order tax-on-tax effect is
  out of scope (per-night/per-person is the standard French taxe de séjour and is exact).
- Tax frozen on a past reservation (`freezeTouristTax`) → the frozen amount is the one subtracted.

---

## 4. Architecture

> **Fat backend.** The whole fix is in the pricing engine; the client « Paiement plateforme » block
> already derives the écart from the server `platformNetReceivedAmount` / `totalStayPrice`, so it
> needs no change — it simply stops showing the phantom écart once the server numbers are right.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `utils/pricing.js` | T | Compute the tourist-tax mode flags (`collectsFromGuest`, `isTouristTaxRemittedByOwnerFlag`) and the tax breakdown / `touristTaxTotal` **before** the brut→accommodation back-solve (using the same accommodation base as today so amounts don't move), then subtract the reversed tax from the brut in `pinnedAccommodation`. No signature change; all returned fields keep their meaning (with corrected values for case 1 + brut). |
| `models/` / `routes/` | — | — | (none) |
| `database.js` | — | — | (none — no schema change) |

**Notes:**
- The change is a **reordering** plus one guarded subtraction term; every existing branch keeps its
  current value because the new term is 0 unless (brut set ∧ reversed tax ∧ tax > 0).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/reservation/FinanceSection.js` | — | None. The écart reads `platformNetReceivedAmount` / `totalStayPrice` from the quote and now reconciles to 0 automatically. |

**Component reuse declaration:** no component added or changed.

### 4.3 API contract

No endpoint or payload-shape change. `calculateReservationQuote` returns the same fields; for the
case-1 + brut scenario the values (`finalPrice`, `totalStayPrice`, `balanceAmount`,
`platformNetReceivedAmount`) are corrected.

---

## 5. Data model

No schema change, no migration. Stored amounts are recomputed on the next save/recompute (the engine
is the source of truth); no backfill needed.

## 6. UI / UX

No visual change beyond the natural effect: on a platform_reversed reservation with a brut entered,
« Net perçu » equals the virement and the chip shows « ✓ cohérent avec le virement » instead of
« écart : {tax}€ ». No responsive concern (no layout change).

## 7. Test plan

### Server unit tests
- [ ] `tests/pricing-platform-tourist-tax-reversed-brut.unit.test.js` (new) — **non-regression for
  this case**: platform_reversed + brut = accommodation + tax, commission entered →
  `finalPrice = accommodation`, `totalStayPrice = balanceAmount = brut`,
  `platformNetReceivedAmount = brut − commission`, écart vs `brut − commission` = 0. Plus a guard
  assertion that the **same scenario without a brut** is unchanged.
- [ ] Existing suites stay green (no value moves elsewhere): `pricing-tourist-tax-three-way`,
  `pricing-platform-commission`, `accounting-model-tourist-tax`, `tourist-tax-collection-coverage`.

### Manual UI verification
- [ ] On a platform_reversed reservation, enter the brut (incl. tax) + commission → « Net perçu »
  matches the virement, chip « ✓ cohérent ».
- [ ] Regression: a direct reservation and a platform-offered (case 2) reservation are unchanged.

## 8. Out of scope

- Owner-collect tax (case 3) and platform-offered tax (case 2) — unaffected.
- Percentage-mode tax-on-tax second-order precision (documented edge case).
- The « Calculer la commission » button behaviour (unchanged).

## 9. Open questions

Resolved before drafting:
- Q: How should the reversed tourist tax enter the platform-payment calc? → **A: as part of the
  brut** (an option-like line already included in what the guest paid), subtracted in the
  accommodation back-solve so it is not double-counted.
