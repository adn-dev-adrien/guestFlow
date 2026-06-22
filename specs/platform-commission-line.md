# Platform commission line in the reservation summary

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-commission-line-in-summary` |
| **Created** | 2026-06-20 |
| **Author** | Adrien |

---

## 1. Context

For a **platform** reservation (Airbnb, Booking…) the platform keeps a **commission** out of the stay.
The operator wants the reservation **PricingSummary** (right-side recap) to show, explicitly, the full
stay total, the commission deduction, and the **net** they actually receive — and, per the fat-backend
rule, with the net **computed by the pricing engine**.

> **Revision 2026-06-21 (current behaviour).** The commission is now **operator-entered directly** (a new
> « Commission plateforme » € field), and the summary reads: **brut = total séjour**, **net perçu = total
> séjour − commission**. The original 2026-06-20 design derived the commission from the gross
> (`clientGrossAmount − finalPrice`) and showed **brut = gross**, **net = total séjour** — see §9.

## 2. Goal

For a platform reservation with an operator-entered commission, the summary shows the deduction
explicitly (example: total séjour = 250 €, commission = 40 €):

```
Total du séjour TTC (brut)   250,00 €   ← nights + options + resources (the full stay)
Commission plateforme       − 40,00 €   ← operator-entered
Net perçu TTC                210,00 €   ← total séjour − commission (engine-computed)
```

Both the commission and the net are **engine-authoritative** (`quote.platformCommissionAmount` +
`quote.platformNetReceivedAmount`); the summary only renders them.

## 3. Functional rules

1. **Commission is operator-entered.** A new « Commission plateforme » € field
   (`reservations.platformCommissionAmount`) holds the amount the platform retains. Clamped **≥ 0**.
   **Non-direct platforms only** — direct bookings always have commission **0** (the field isn't shown,
   the value is forced NULL on save). This is the whole reason the display mode is platform-only.
2. **Net = total séjour − commission.** The engine returns
   `platformNetReceivedAmount = round(totalStayPrice − platformCommissionAmount)` when the commission
   is > 0, else **null** (→ the summary collapses to the single « Total du séjour TTC » line).
3. **Summary display.** When `platformCommissionAmount > 0`, the « Total du séjour » block becomes three
   lines: **Total du séjour TTC (brut)** = `totalStayPrice` (the full stay: nights + options + resources),
   **Commission plateforme** = `− commission`, **Net perçu TTC** = `platformNetReceivedAmount`. When it's
   0, the single « Total du séjour TTC » line is shown exactly as before.
4. **Tax is a pass-through**, untouched by the commission: it sits in `totalStayPrice` (the brut); the
   commission is then deducted from that.
5. **The solde IS the net perçu (2026-06-21).** On a non-direct platform reservation the engine deducts
   the commission from the **balance**: `balanceAmount = max(0, preArrivalAmount − commission)`. The
   commission is **not** a complement — the auto-gap baseline is reduced to the owner's net
   (`ownerStayTotal = totalStayPrice − commission`) so it can't re-surface there. So for a stay with no
   on-arrival complement, **solde = net perçu**; with a complement, `solde + complément = net perçu`
   (the owner's total receipts). Direct reservations are untouched.
6. **Accounting reads the solde.** `accountingModel.encaissementsByMonth` books `row.balanceAmount` as
   the balance encaissement — which is now the **net** — so the compta records what the operator actually
   banked. The existing gross-based CA recognition (on `clientGrossAmount`) is **unchanged** (kept per the
   2026-06-21 questionnaire): when no gross is entered the commission journal is inert and the net solde is
   booked as-is; « Prix payé par le client » + « Total du séjour » keep their name/formula.
7. **Live recompute.** The commission is in the quote signature, so the « net perçu » + solde update as the
   operator types.
6. **« Prix payé par le client » stays separate/informative.** The existing `clientGrossAmount` field is
   unchanged and keeps driving the **accounting** commission (`gross − finalPrice` in `accountingModel` +
   the CSV export). The new field is for the **fiche net** only — accounting is deliberately untouched
   here (§8).

## 4. Architecture

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` + `schema.sql` | — | T | New nullable column `reservations.platformCommissionAmount REAL` (idempotent `ADD COLUMN` + base schema). |
| `utils/pricing.js` | `pricing.js` | T | `calculateReservationQuote` accepts `platformCommissionAmount`; returns it clamped (≥ 0, 0 on direct) + `platformNetReceivedAmount = totalStayPrice − commission` (null when 0). The old `clientGrossAmount`-derived commission was removed from the engine. |
| `models/reservationsModel.js` | `reservationsModel.js` | T | Persist `platformCommissionAmount` (clamped ≥ 0, NULL on direct) on insert/update; expose it from `getReservationById` (`''` when unset). |
| `controllers/reservationsController.js` | `reservationsController.js` | T | Validate `platformCommissionAmount` (money) on create/update; forward it to the engine in `calculatePrice`. |

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/ReservationPage.js` | `ReservationPage.js` | T | New form field `platformCommissionAmount`; send it in the `calculate-price` + save payloads; add it (and `clientGrossAmount`) to the quote signature for live recompute. |
| `components/reservation/FinanceSection.js` | `FinanceSection.js` | T | Replace the read-only « Commission plateforme » readout with an **editable** `ArithmeticTextField` bound to `platformCommissionAmount` (platform-only). « Prix payé par le client » kept as-is. |
| `components/PricingSummary.js` | `PricingSummary.js` | T | When `platformCommissionAmount > 0`, render brut = `totalStayPrice` / `− commission` / net = `platformNetReceivedAmount`; else the single total line. |

### 4.3 API

`POST /api/reservations` + `…/calculate-price` accept `platformCommissionAmount`; the quote response
gains `platformCommissionAmount` (resolved) + `platformNetReceivedAmount`.

## 5. Data model

New column `reservations.platformCommissionAmount REAL` (nullable). Stored clamped ≥ 0 for non-direct
platforms, **NULL** for direct bookings. No backfill needed (NULL = no commission). Distinct from
`clientGrossAmount` (kept for accounting).

## 6. UI / UX

- FinanceSection « Plateforme » block (platform reservations only): two fields side-by-side — « Prix payé
  par le client » (gross, informative/accounting) and the new « Commission plateforme » (€, editable),
  helper « Montant TTC retenu par la plateforme. Déduit du total du séjour pour le « Net perçu ». »
- PricingSummary: commission > 0 → the 3-line block (brut = total séjour / − commission / net perçu);
  the commission is `warning`-coloured, the net is the primary headline.
- Direct, or no commission → unchanged single « Total du séjour TTC » line.
- Responsive: same `space-between` rows as the rest of the summary; the two FinanceSection fields stack
  on `xs` (md=6 each).

## 7. Test plan

### Server
- [x] `pricing-platform-commission.unit.test.js` (8) — entered commission echoed + net = total − commission;
  direct → 0/null; no commission → 0/null; negative clamped to 0; commission with options; **solde = net perçu
  (commission off the balance)**; **forced-complement extra stays in the complement, commission only on the
  solde**; direct balance untouched.
- [x] `reservations-platform-commission-persistence.unit.test.js` (6) — insert/update round-trip; clamp ≥ 0;
  empty → NULL; direct forced NULL; switching to direct clears it.
- [x] `accounting-encaissements-integration.unit.test.js` (+1) — the balance entry encaissement is the stored
  (net) solde for a platform reservation → the compta books the net.

### Client (vitest)
- [x] `PricingSummary.commission.test.js` (2) — commission > 0 → brut = total séjour / « Commission
  plateforme » / net perçu = total − commission; commission 0 → the plain single total line.

> **Revision 2026-06-22 — « Prix payé par le client » retired + accounting wired to the commission field.**
> The `clientGrossAmount` input was removed from the fiche (it was redundant now that the commission is
> entered directly). The accounting no longer derives the commission from a gross; instead, for a platform
> reservation with an operator-entered `platformCommissionAmount`, `accountingModel.buildEntry` recognises
> the **CA on the total séjour** (= `finalPrice`, with the settings VAT), books the **commission** (the
> entered field) on `622600`/`6226xx`, and reports the **net perçu** (= solde = total − commission). Because
> the engine already stores the NET in the solde (spec §3 rule 5), `grossRatio = finalPrice / (finalPrice −
> commission)` grosses the stored amounts back up to the total séjour so Σ debits = Σ credits = total séjour.
> A **legacy fallback** keeps the old gross-based recognition for reservations that still have a stored
> `clientGrossAmount` and no entered commission. Confirmed by questionnaire: CA = total séjour, VAT at the
> settings %, commission = the fiche field, net perçu shown. The `clientGrossAmount` column is kept for
> legacy data + the boot backfill but is no longer entered or used for new reservations.
>
> **Accounting display (AccountingPage).** The platforms table + the journal cards now show
> **Revenu brut / Commission / Net perçu (versement)** — the net is `encaissementNetTtc` (exposed as
> `net` by `platformsPreview` + the structured export), so the operator can reconcile against the
> platform's actual bank transfer. Validated on the real prod case Booking #6622323293 (Estelle Z.):
> revenu brut 102,50 € · commission 16,48 € · versement 86,02 € (was wrongly showing commission 0,01 €
> and no versement under the old gross-based model). The sales CSV already carries the columns the
> accountant requires (Jour/Mois/Année, comptes 70600000/70600010/70601000, TVA 44571200/44571100,
> compte client, libellé, débit, crédit) — unchanged.

## 8. Out of scope

- Deriving the commission from a platform % (the tarif-page feature).
- Showing the commission on direct bookings (0 by definition).
- Removing the legacy `clientGrossAmount` column (kept for already-booked reservations + the boot backfill).

## 9. Open questions

- ✅ **2026-06-20 (original):** commission source = gross − net; display = « brut(=gross) − commission =
  net(=total séjour) ».
- ✅ **2026-06-21 (revised, questionnaire):** commission source = **new operator-entered field**; display =
  « brut(=total séjour) − commission = net perçu ». « Prix payé par le client » kept separate/informative.
- ✅ **2026-06-21 (follow-up):** the **solde = net perçu** (commission deducted from the balance) and the
  **compta books that net solde** (`accountingModel` reads `row.balanceAmount`). Per the questionnaire: CA
  basis = total paid by client (= net + commission, the existing gross-based recognition) → **no accounting
  formula change**; « Total du séjour » **not renamed**, no formula change; `clientGrossAmount` **kept**.
- ✅ **2026-06-22 (revised):** « Prix payé par le client » **retired**; the accounting commission now comes
  from the **`platformCommissionAmount` field** — CA on the total séjour (with settings VAT), commission
  booked, net perçu = solde. Legacy reservations (stored gross, no entered commission) keep the old
  recognition via a fallback. Supersedes the « gross-based recognition stays » note above.
