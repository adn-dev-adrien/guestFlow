# Per-échéance platform commission

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-per-echeance-commission` _(user-managed)_ |
| **Created** | 2026-06-22 |
| **Author** | Adrien |
| **Depends on** | PR #274 (revert per-payment-method commissions) — built on that base |

---

## 1. Context

Platform reservations carry an operator-entered commission (`platformCommissionAmount`). Since the
acompte toggle (#276), that single figure is **split proportionally** across acompte + solde in the
accounting. But the operator gets **exact per-transaction fees** from Lodgify/Stripe (e.g. acompte 3,41 €,
solde 2,61 €) — a proportional split can't reproduce them. The operator wants to **type the exact
commission on each échéance**, booked on the platform's commission account like every other commission.

## 2. Goal

On a platform reservation, the operator types a **commission amount per échéance** — one in the Acompte
block, one in the Solde block. Each is booked in the accounting on the **platform's commission account**
(same as the existing platform commission), on that échéance's journal entry. The « net perçu » = total
séjour − the sum of the per-échéance commissions.

## 3. Functional rules

1. A **« Commission »** input appears in the **Acompte** block and in the **Solde** block of a platform
   reservation's fiche. Direct reservations are unaffected (no platform commission).
2. The acompte/solde **amounts are the gross guest-facing figures** (what the guest pays): `deposit =
   depositPercent × total`, `balance = total − deposit` (manual acompte override still allowed). The
   commission is shown **separately**, not subtracted from the displayed amount. **PricingSummary
   displays these gross amounts as-is** under the labels **« Montant acompte payé par le client » /
   « Montant solde payé par le client »** (platform reservations); the commission + net « Versement
   plateforme » are broken out in the cascade above. Clarified 2026-07-16 (Damien Nicolet): the earlier
   « show the net (montant − commission) on the acompte/solde line » behaviour was removed — a figure
   labelled « payé par le client » must be the gross, and the operator must enter the **gross** the
   guest is charged (e.g. Lodgify charges 126,38 → the operator's 122,97 net take + 3,41 commission).
3. `acompteCommissionAmount` (new) = the commission on the acompte; `platformCommissionAmount` (existing,
   reused) = the commission on the **solde**. Both ≥ 0, clamped to their échéance amount.
4. **Net perçu = total séjour − (acompteCommissionAmount + platformCommissionAmount).** Shown in the
   summary, mirroring the current « net perçu » line.
5. **Accounting** (the heart of the change): each paid échéance books its **own** commission on the
   platform's account (`resolveCommissionConfig`), on that entry — `acompteCommissionAmount` on the
   deposit entry, the balance carries `commissionTtcTotal − acompteCommissionAmount` (= the solde
   commission). The complement carries none (on-site). This **replaces** the #276 proportional split.
   - The existing **gross-up `grossRatio = finalPrice / storedSum` is kept** (not forced to 1): for the
     new gross-stored reservations `storedSum = finalPrice` so it's 1 (CA = the échéance amount); for
     **old net-stored reservations** (saved before this change, no acompte commission) it grosses the
     stored net up to the total — so the existing accounting tests + un-re-saved prod rows stay correct.
     net cash per entry = gross − its commission.
6. A no-acompte platform (deposit = 0) → the whole thing is the solde: `platformCommissionAmount` books on
   the balance, CA = total, net = total − commission. (Same shape as today, minus the gross-up — the solde
   now stores the gross total instead of the net.)

**Concrete example** (total séjour 580 €, depositPercent 30 %):
| | Amount (gross) | Commission → 622xxx | Net cash |
|---|---|---|---|
| Acompte | 174,00 € | 3,41 € | 170,59 € |
| Solde | 406,00 € | 2,61 € | 403,39 € |
| **Total** | **580,00 € (= CA)** | **6,02 €** | **573,98 € (= net perçu)** |

**Edge cases:**
- Commission > its échéance amount → clamped to the amount (net cash ≥ 0).
- Switch platform → direct → both commissions cleared (no platform commission on direct).
- Past/not-re-saved reservation stored under the old net model → re-saving recomputes to the gross model;
  see §5 migration.

---

## 4. Architecture

### 4.1 Server (`server/src/`)
| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` / `schema.sql` | | T | `reservations.acompteCommissionAmount REAL` (idempotent, DEFAULT NULL). |
| `utils/pricing.js` | | T | Stop netting the pre-arrival by the commission: deposit/balance split the **gross** pre-arrival; `platformNetReceivedAmount = total − acompteCommission − platformCommission`. |
| `models/accountingModel.js` | | T | Per-entry platform commission (acompte→deposit, solde→balance), `grossRatio = 1` for the entered-commission path; drop the proportional split. |
| `controllers/reservationsController.js` | | T | Validate + forward `acompteCommissionAmount` (money). |
| `models/reservationsModel.js` | | T | Persist `acompteCommissionAmount`. |
| `tests/` | `platform-per-echeance-commission.unit.test.js` | C | Engine net perçu + accounting per-entry commission, CA = total, net cash, balanced. |

### 4.2 Client (`client/src/`)
| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/reservation/FinanceSection.js` | | T | « Commission » field in the Acompte block (`acompteCommissionAmount`) + in the Solde block (`platformCommissionAmount`). |
| `components/PricingSummary.js` | | T | Show the per-échéance commissions + the « net perçu » = total − Σ. |
| `pages/ReservationPage.js` | | T | Carry `acompteCommissionAmount` in form state, calc-price + save payloads. |
| `api.js` | | — | Threaded through existing reservation calls. |

### 4.3 API
`acompteCommissionAmount` added to the reservation create/update/calculate-price payloads and echoed in
the quote. No new endpoint.

## 5. Data model

`reservations.acompteCommissionAmount REAL` (idempotent ADD COLUMN, DEFAULT NULL = 0). `platformCommissionAmount`
keeps its column, re-meaning « solde commission ».

**Migration / behaviour shift:** the platform acompte/solde now store **gross** amounts (was net under
#276). The accounting reads the stored amounts as gross with `grossRatio = 1` for the entered-commission
path. Existing platform reservations re-derive to the gross model on their next save; the accounting for
not-yet-re-saved rows stays balanced because the per-entry commission + amounts always reconcile to the
stored figures (Σ debits = Σ credits by construction). **Data impact:** the displayed solde changes from
net to gross on platform reservations once re-saved; no money is lost (net perçu is unchanged).

## 6. UI / UX

- **Acompte block:** an `ArithmeticTextField` « Commission » under the montant, bound to
  `acompteCommissionAmount`. Shown only for platform reservations.
- **Solde block:** the same « Commission » field bound to `platformCommissionAmount` (moved out of the
  « Paiement plateforme » block to sit with the solde it applies to).
- **PricingSummary:** under « Total du séjour TTC », two lines « Commission acompte − X » / « Commission
  solde − Y », then « Net perçu TTC = total − (X+Y) ». The **Acompte / Solde lines below show the GROSS**
  (the stored amount) under « Montant acompte/solde payé par le client » for platform reservations;
  direct reservations keep the plain « Acompte » / « Solde » labels (no commission → gross = net).
- Responsive: the commission field stacks under the amount on `xs`.

## 7. Test plan

### Server unit — `tests/platform-deposit-toggle.unit.test.js` + `tests/pricing-platform-commission.unit.test.js`
- [x] Engine: net perçu = total − acompteComm − soldeComm; deposit/balance split the **gross** pre-arrival.
- [x] Accounting: acompte entry books `acompteCommissionAmount` on the **platform's account**; solde entry
  books the solde commission; complement none; CA = total; net cash per entry = amount − commission;
  Σ debits = Σ credits.
- [x] Backward-compat: a no-acompte platform books the whole commission on the solde; the legacy
  `clientGrossAmount`-derived path + net-stored reservations stay green (existing accounting suites).
- Full server suite: **1781/1781**.

### Manual UI
- [x] (Playwright) Lodgify résa with acompte: commission fields in the Acompte + Solde blocks; PricingSummary
  shows « Commission acompte / Commission solde » + net perçu = total − Σ; client **577/577**, build green.

## 8. Out of scope

- A commission field on the complement (on-site / host-billed → no platform commission).
- The reverted per-payment-method (Stripe rate) feature.
- Re-introducing a global single commission with proportional split (this replaces it).

## 9. Open questions

- Q: Displayed acompte/solde = **gross** (guest-facing) with commission shown separately?
  - A: **Yes** — matches the operator's chosen model (« Acompte 200 € · commission 3,41 € »).
- Q (Resolved 2026-07-16, Damien Nicolet): should the PricingSummary Acompte/Solde line show the gross
  or the net-of-commission?
  - A: **The GROSS**, under « Montant acompte/solde payé par le client ». The operator enters the gross
    the guest is charged (Lodgify: net take + commission). Showing the net under an « Acompte » label
    made a 122,97 € take-home display as 119,56 € and read like a bug. Locked by
    `PricingSummary.commission.test.js` (client) + `accounting-effective-percent.unit.test.js` (server,
    CA = gross, net perçu = gross − commission).
