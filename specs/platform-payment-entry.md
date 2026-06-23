# « Paiement plateforme » — direct entry of the platform's amounts

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-payment-entry` |
| **Created** | 2026-06-22 |
| **Author** | Adrien |

---

## 1. Context

For a platform reservation the operator must, today, **reconstruct the stay total by hand** so that the
fiche's « Total du séjour TTC » matches the amount the platform actually charged the guest — by tweaking
the « Prix ajusté » (accommodation `customPrice`) until `accommodation + options = the platform gross`.
Then they enter the commission. This reconciliation is the real « casse-tête » (confirmed on two real
prod cases, Booking #6622323293 and Gîtes-de-France #1415).

But every platform hands the operator the **same three numbers**, and only two are independent:

| | Booking | Gîtes de France |
|---|---|---|
| Montant total payé par le client (**brut**) | 102,51 | 687 |
| Commission | 16,48 | 61 |
| **Virement reçu (net)** | **86,02** | **626** (= brut − commission) |

The operator should be able to **type those numbers directly**, not back-solve the accommodation price.

Relies on the existing model (spec `platform-commission-line.md`): the commission is operator-entered
(`platformCommissionAmount`), the solde = net = total − commission, and the accounting books CA on the
total séjour + the commission + the net (versement).

## 2. Goal

A dedicated **« Paiement plateforme »** block (platform reservations only) where the operator enters the
platform's figures verbatim:

- **Montant total payé par le client** (the brut) → **pins the total séjour** to this value (the
  accommodation auto-fits = brut − billed options − billed resources). No more adjusting « Prix ajusté ».
- **Commission plateforme** (existing field).
- **Virement reçu** (optional) → a reconciliation control: a green ✓ when `brut − commission == virement`.

The net perçu (= solde) and the accounting are unchanged downstream — only the **input** is simplified.

## 3. Functional rules

1. **Brut pins the PLATFORM-PAID portion of the stay.** When `platformGrossAmount` is set (non-empty) on a
   **non-direct** reservation, the brut is what the guest paid the platform = the pre-arrival total. The
   engine derives the accommodation = `platformGrossAmount − extraGuestSurcharge − billed NON-complement
   options − billed NON-complement resources` (the *billed*, i.e. non-offered, pre-arrival totals), clamped
   to ≥ 0. So a non-complement option/resource re-allocates within the fixed brut.
1bis. **Complement extras are ADDED ON TOP (collected on arrival).** Options/resources routed to the
   **Complément** (`inComplement = 1`) are NOT part of the platform payment — they're collected on arrival.
   They are therefore EXCLUDED from the back-solve and **add to the total**: `finalPrice = brut +
   complement`. (Regression 2026-06-22: before this, the brut subtracted EVERY option incl. complement, so
   an arrival extra silently lowered the accommodation and the total stayed = brut — wrong. Locked by
   `pricing-platform-gross-pin.unit.test.js`.) The operator keeps the per-line « Compl. » toggle to choose,
   per option, whether it's part of the brut (in the platform payment) or collected on arrival.
2. **Precedence.** On a non-direct reservation, `platformGrossAmount` **replaces** `customPrice` /
   `discountPercent` as the accommodation driver (the block hides « Prix ajusté » for platform
   reservations). On a direct reservation the field is absent and the existing pricing path is unchanged.
3. **Empty brut = current behaviour.** If `platformGrossAmount` is empty, the engine computes the total
   the normal way (accommodation from pricing rules + options) — backward compatible for existing platform
   reservations that have no brut yet.
4. **Commission unchanged.** `platformCommissionAmount` keeps its meaning; net perçu = `finalPrice −
   commission` = solde (spec `platform-commission-line.md` §3 rule 5). Clamped ≥ 0.
5. **Virement = reconciliation only.** `platformPayoutAmount` (the bank transfer the operator actually
   received) is stored for audit + drives a UI ✓/✗ vs the computed net. It **never** changes any
   amount/accounting — purely a sanity check. ✓ when `|net − virement| < 0.01`. The `net` here is the
   **pre-arrival** the platform settles (`preArrivalAmount − commission`), **NOT** `totalStayPrice −
   commission`: for an owner-collect platform the tourist tax (and any on-site extra) sits in the complement
   and is collected by us at check-in, so it is never part of the platform's virement. (Fixed 2026-06-23:
   the reconciliation previously used `totalStayPrice`, so an owner-collect reservation always showed an
   écart equal to the tourist tax. Locked by `pricing-tourist-tax-on-arrival-schedule.unit.test.js` +
   `FinanceSection.platform-no-deposit.test.js`.)
6. **Accounting unchanged.** CA on the total séjour (split accommodation 70600000 + options 70600010),
   commission booked, net = solde (already validated by `platform-commission-line.md`). The brut just
   makes `finalPrice` land on the right number; the buckets/VAT/commission flow is identical.

**Edge cases**
- Brut < billed options + resources → accommodation clamps to 0 (the operator entered an inconsistent
  brut; the net/✓ surfaces it). No negative accommodation.
- Switching platform → direct: the brut/virement become inert (engine ignores them on direct); the fields
  are hidden. The stored values stay (re-applied if switched back to a platform).
- Offered option on a platform: excluded from `billedOptionsTotal`, so the accommodation isn't reduced by
  an offered (0 €) line.

## 4. Architecture

> **Fat backend.** The brut→accommodation derivation + the pin live in the pricing engine; the client only
> renders the block and threads the three fields. The ✓ check is a trivial UI comparison of two engine
> numbers.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` + `schema.sql` | — | T | Two new nullable columns on `reservations`: `platformGrossAmount REAL`, `platformPayoutAmount REAL` (idempotent ADD COLUMN + base schema). |
| `utils/pricing.js` | `pricing.js` | T | `calculateReservationQuote` accepts `platformGrossAmount`. When set + non-direct: derive the accommodation price so `finalPrice = platformGrossAmount` (= brut − billed options − billed resources, ≥ 0); bypass the `customPrice`/`discountPercent` accommodation path. Returns `platformGrossAmount` echoed + the usual `platformCommissionAmount`/`platformNetReceivedAmount`. |
| `models/reservationsModel.js` | `reservationsModel.js` | T | Persist `platformGrossAmount` + `platformPayoutAmount` (NULL on direct) on insert/update; expose them from `getReservationById`. |
| `controllers/reservationsController.js` | `reservationsController.js` | T | Validate both (money) on create/update; forward `platformGrossAmount` (+ `platform` + `platformCommissionAmount`) to the engine in **`calculatePrice` AND `create`/`update`** — **bugfix 2026-06-22:** create/update previously didn't pass them (nor `platform` on create), so the persisted finalPrice ignored the brut pin and the solde wasn't reduced to the net (fiche showed 994/903, books stored 983/892). The live preview and the books must price identically. |

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/reservation/FinanceSection.js` | `FinanceSection.js` | T | New « Paiement plateforme » block (platform only): `Montant total payé par le client` (→ `platformGrossAmount`), `Commission plateforme` (→ `platformCommissionAmount`), `Virement reçu` (→ `platformPayoutAmount`) + the computed « Net perçu » with a ✓/✗ chip vs the virement. Hide « Prix ajusté »/« Réduction » for platform reservations (the brut drives the price). |
| `pages/ReservationPage.js` | `ReservationPage.js` | T | Form fields + defaults; thread `platformGrossAmount` (in the quote signature + calc/save payloads) and `platformPayoutAmount` (save only — no recompute). Load them from the reservation. |
| `components/PricingSummary.js` | `PricingSummary.js` | — | No change — the summary already reads `totalStayPrice`/commission/net from the quote. |

### 4.3 API

`POST /api/reservations` + `…/calculate-price` accept `platformGrossAmount` (+ `platformPayoutAmount` on
save). The quote echoes `platformGrossAmount`; `finalPrice`/`platformNetReceivedAmount` reflect the pin.

## 5. Data model

Two new nullable columns on `reservations`: `platformGrossAmount REAL`, `platformPayoutAmount REAL`. NULL
for direct + for platform reservations that don't use the block (backward compatible). No backfill.

## 6. UI / UX

The « Plateforme » block (today = just the commission field) becomes **« Paiement plateforme »**:

```
Paiement plateforme
  Montant total payé par le client   [ 687,00 ]   ← le brut ; fixe le total du séjour
  Commission plateforme              [  61,00 ]
  Virement reçu (contrôle)           [ 626,00 ]   ✓ cohérent
  ────────────────────────────────────────────
  Net perçu : 626,00 €   (= solde)
```

- Helper under the brut: « Montant total facturé au client par la plateforme — l'hébergement s'ajuste
  automatiquement (brut − options). »
- ✓ green chip when `net == virement`; ✗ amber « écart : X € » otherwise. No virement entered → no chip.
- « Prix ajusté » + « Réduction » are **hidden** for platform reservations (the brut is the single price
  lever); they stay for direct.
- Responsive: the three fields stack on `xs` (md=4 each), the net line full-width.
- Mobile: the ✓/✗ chip wraps under the virement field.

## 7. Test plan

### Server unit tests
- [x] `pricing-platform-gross-pin.unit.test.js` (7) — brut set → `finalPrice = brut`; accommodation = brut
      − non-complement options; **a complement option is ADDED on top (collected on arrival), not folded in
      (regression — operator-reported 2026-06-22)**; offered option excluded; brut < options → accommodation
      clamps 0; empty brut → normal pricing; direct ignores the brut; brut + commission → net = brut − commission.
- [x] `reservations-platform-commission-persistence.unit.test.js` (+4) — round-trip `platformGrossAmount` +
      `platformPayoutAmount`; empty → NULL; direct forced NULL; update + switch-to-direct clears them.

### Client (vitest)
- [x] `FinanceSection.platform-no-deposit.test.js` (+4) — platform → the 3 fields render, « Prix ajusté »
      hidden; direct → no block, « Prix ajusté » shown; ✓ chip when net == virement, ✗ + écart otherwise.

### Manual UI verification
- [ ] Type brut 687 + commission 61 → total séjour = 687, net 626, accommodation auto = 607. Enter
      virement 626 → ✓. Save → reload → values repopulate. _(blocked — port 4000 occupied by the running
      API; covered by the engine + FinanceSection unit tests.)_

## 8. Out of scope

- Auto-importing the platform's amounts from an email/API (manual entry only).
- Deriving the commission from a platform % (separate tarif-page feature).
- The retroactive « auto-option added when the global checkout time changed » issue (tracked separately).
- Changing the accounting (already correct per `platform-commission-line.md`).

## 9. Open questions

1. ✅ **Engine-pin vs client helper** (2026-06-22) → **engine pin** (`platformGrossAmount` forces the
   total; robust if options change later).
2. ✅ **Persist the virement?** → **yes** (`platformPayoutAmount`, for audit + the ✓ check).
3. ✅ **Hide « Prix ajusté » on platforms?** → **yes** (the brut is the single price lever; kept on direct).
