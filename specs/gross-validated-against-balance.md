# "Prix payé par le client" validated against the balance (not the total stay)

| Field | Value |
|---|---|
| **Status** | Superseded — the validated field was removed on 2026-06-22 (noted 2026-10-27) |
| **Branch** | `fix/gross-vs-balance` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related** | [force-extras-complement-on-platform.md](force-extras-complement-on-platform.md) |

> **Superseded — noted 2026-10-27 (spec review).** The « Prix payé par le client » input and its
> validation were **removed on 2026-06-22**: the platform commission is now entered by the operator and
> the accounting recognises the revenue on the total stay, so there is no gross input left to validate
> (`server/src/tests/reservations-controller-platform-normalisation.unit.test.js`, header comment — the
> `GROSS_BELOW_NET` tests were deleted then). Neither `reservationsController.js` nor `devisController.js`
> calls `validateClientGrossAmount` any more (both import only `validateFinanceInputs`), and the client
> has no `clientGrossAmount` field. Rules 1–2 and §4 are therefore historical.
>
> **Dead code left behind (not removed in this docs-only pass):** `validateClientGrossAmount` and
> `ERROR_GROSS_BELOW_NET` in `server/src/utils/financeValidation.js` are referenced only by their own
> test, `server/src/tests/client-gross-amount.unit.test.js`, and by inert stubs in the mocks of a few
> controller tests (`validateClientGrossAmount: () => null`). They can go in a later code clean-up. The
> `reservations.clientGrossAmount` **column** is not dead: the accounting-export plugin still reads it as a
> legacy fallback for rows saved before the change (`server/src/plugins/accounting-export/accountingModel.js`).

---

## 1. Context

On a platform reservation, the operator enters **"Prix payé par le client"** (`clientGrossAmount` —
what the guest paid the platform). It was validated as `gross ≥ finalPrice` (the **full stay**),
both server-side (`validateClientGrossAmount`) and client-side (`FinanceSection`), and the helper
text said *"Doit être ≥ {finalPrice}€"*.

That reference is wrong now that extras are collected on arrival: the platform only covers the
**solde** (balance = accommodation; the extras live in the complément, collected on site — see
`force-extras-complement-on-platform.md`). So a legitimate gross that covers the balance but not the
on-arrival complément was rejected with a false "must be ≥ total" error.

## 2. Goal

The "Prix payé par le client" error/threshold compares the gross against the **balance (solde)**, not
the total stay price.

## 3. Functional rules

1. The gross is valid when `gross ≥ balanceAmount` (the platform-covered amount). Below the balance →
   `GROSS_BELOW_NET` (400 server / inline error client).
2. **Commission display is unchanged** — still `gross − finalPrice` (clamped ≥ 0). Only the *validation
   threshold* + the helper-text reference move to the balance (per the operator's decision: "seuil
   seulement").
3. **Accounting unchanged** — the complément is already a separate encaissement entry; no change.
4. Direct bookings unaffected: the controller still coerces `clientGrossAmount = finalPrice` for
   directs (commission 0), and `finalPrice ≥ balance` so the check trivially passes.

**Edge cases:**
- `gross` between balance and finalPrice (extras in complément) → **accepted** (was wrongly rejected).
- `gross` below balance → rejected.

---

## 4. Architecture

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `controllers/` | `controllers/reservationsController.js` | T | Pass `quote.balanceAmount` (was `quote.finalPrice`) to `validateClientGrossAmount` in create + update. |
| `utils/` | `utils/financeValidation.js` | T | Doc-only: the `validateClientGrossAmount` reference is the balance now (logic unchanged — generic `gross < reference`). |
| `components/reservation/` | `components/reservation/FinanceSection.js` | T | `grossBelowNet` + helper text compare against `pricingQuote.balanceAmount`; commission display keeps `finalPrice`. |

No DB / API change.

## 5. Data model

No change.

## 6. UI / UX

The "Prix payé par le client" field's error now reads *"Doit être ≥ {balance}€ (solde réglé via la
plateforme)."* The "Commission plateforme" box is unchanged.

## 7. Test plan

### Server unit tests
- [x] `reservations-controller-gross-coercion` (extended): platform + gross ≥ balance but < finalPrice
  → **200** (extras in complément); platform + gross < balance → **400**; the prior "gross below"
  case still 400 (default balance = finalPrice); directs still coerced. (12 tests.)

### Client
- [x] Full client suite green (393); `FinanceSection` threshold/help-text reference moved to balance.

### Manual UI verification
- [ ] Platform reservation with an option (in complément): enter a gross covering only the
  accommodation → no error (was "must be ≥ total"); enter below the balance → error. *(pending — needs
  the running app.)*

## 8. Out of scope

- Recomputing the **commission** on the balance (operator chose "seuil seulement" — commission stays
  `gross − finalPrice`).
- Any accounting change (the complément is already a separate encaissement).

## 9. Open questions

(None — resolved 2026-06-08: threshold-only; accounting unchanged.)
