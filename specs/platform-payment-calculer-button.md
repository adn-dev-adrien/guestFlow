# Platform payment — « Calculer » button (deduce the solde commission)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-payment-calculer-button` _(user-managed)_ |
| **Created** | 2026-06-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

> **Updated 2026-10-27 (spec review) — the formula moved to the server.** §4 « pure local computation,
> no server change, no API change » no longer holds. The fiche's « Calculer la commission » now lives in
> `client/src/components/reservation/PlatformStatementEditor.jsx` and asks the server through
> `api.computePlatformCommission` → **`POST /api/reservations/platform-commission`**
> (`server/src/routes/reservations.js` → `reservationsController.platformCommission` →
> `server/src/utils/platformCommission.js` `computePlatformCommission`), shared with the Booking intake
> plugin so the two can never disagree ([booking-extranet-intake.md](booking-extranet-intake.md) §4.1).
> The formula also gained the tourist tax withheld by the platform:
> `commission = max(0, round2(gross − payout − touristTax − acompteCommission))` (rule 3 otherwise holds).
> Request `{ gross, payout, touristTax?, acompteCommission?, expectedNet?, forMark? }` → `{ commission, … }`
> (`expectedNet` / `forMark` serve the ledger's « Marquer reçu », reservation-payment-ledger.md rule 26).
> Rules 1–2 and 4–5 (one-shot, acompte commission untouched) still describe the behaviour.

---

## 1. Context

The reservation fiche's « Paiement plateforme » block
([FinanceSection.js](../client/src/components/reservation/FinanceSection.js)) lets the operator enter,
for a non-direct reservation: **Montant total payé par le client** (`platformGrossAmount`), **Virement
reçu** (`platformPayoutAmount`), **Commission acompte** (`acompteCommissionAmount`) and **Commission
solde** (`platformCommissionAmount`). The commissions are entered by hand.

**Investigation of the reported "fields blank on reopen" (decided not a persistence bug):** the
platform-payment fields **persist and reload correctly** on a successful save — verified end-to-end on
a clean reservation (`platformGrossAmount`/`platformPayoutAmount` round-trip) and locked by
[reservations-platform-commission-persistence.unit.test.js](../server/src/tests/reservations-platform-commission-persistence.unit.test.js).
The « blank on reopen » symptom traces to a **save blocked by a validation error** (booking conflict /
capacity / babies), which discards the whole edit — the « Erreur / Conflit de réservation » dialog is
shown but can be dismissed (« Compris ») without realising nothing was saved. (Out of scope here; can
be improved separately.) The live « Net perçu / écart » already recomputes from `platformPayoutAmount`
at render — no defect there.

The actionable, operator-requested improvement: a **« Calculer » button** to deduce the commission
from the amounts, instead of computing it by hand. The operator was explicit it must be a **button**
(no silent auto-fill that would fight manual edits).

## 2. Goal

In the « Paiement plateforme » block, a **« Calculer la commission »** button fills the **Commission
solde** from the entered amounts on demand — « commission = montant client − virement » — so the books
reconcile (net perçu = virement). The value stays freely editable; nothing changes unless the operator
clicks the button.

## 3. Functional rules

1. The button lives in the « Paiement plateforme » block, beside the « Net perçu / écart » line.
2. It is **enabled only** when both **Montant total payé par le client** and **Virement reçu** are
   filled (and the reservation isn't locked). A tooltip explains the formula / why it's disabled.
3. On click: `Commission solde = max(0, round2(montant client − virement − commission acompte))`.
   _(Updated 2026-10-27: computed by the server, and the tourist tax withheld by the platform is also
   subtracted — see the note at the top.)_
   - With no acompte commission entered → `Commission solde = montant client − virement` (the
     operator's stated rule).
   - With an acompte commission already entered → it's subtracted first, so the **total** commission
     stays `montant client − virement` and « Net perçu » reconciles to the virement.
4. **One-shot, never automatic.** The button only writes when clicked; the field remains a normal
   editable input afterwards (no `useEffect` that re-fills on every keystroke — explicitly avoided per
   the operator's concern about values changing under them).
5. The acompte commission is **not** touched by the button (the operator owns the acompte/solde split).

**Edge cases:**
- Non-numeric amounts → no-op (guarded).
- Negative result (virement > client) → clamped to 0.

---

## 4. Architecture

### 4.1 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `reservation/FinanceSection.js` | T | Add `computeCommissionFromPayout()` + a « Calculer la commission » `Button` (disabled until brut + virement filled) in the platform block. Pure local computation → `updateForm({ platformCommissionAmount })`. |

_(Superseded 2026-10-27: the computation is server-side now — `POST /api/reservations/platform-commission`,
see the note at the top; the button lives in `PlatformStatementEditor.jsx`.)_

No server change, no API change, no schema change. (The "redisplay" turned out to be a blocked-save
symptom, and the live écart already works — both confirmed during investigation, see §1.)

### 4.2 Server

None. _(Superseded 2026-10-27: `utils/platformCommission.js` (pure formula),
`reservationsController.platformCommission`, route `POST /reservations/platform-commission`.)_

## 5. Data model

No change.

## 6. UI / UX

Platform block, reconciliation row: `[ Calculer la commission ]  Net perçu : X€  [✓ cohérent | écart : Y€]`.
The button is `variant="outlined" size="small"`, wrapped in a Tooltip (formula when enabled, « Renseignez
le montant client et le virement reçu » when disabled). Responsive: the row already `flexWrap`s on `xs`.

## 7. Test plan

### Manual UI verification
- [ ] Platform reservation, no acompte: fill montant client = 600 + virement = 520 → « Calculer » →
      Commission solde = 80 ; Net perçu reconciles (écart ✓). Value editable afterwards.
- [ ] With an acompte commission = 10 already set → « Calculer » → solde = 70 (600 − 520 − 10).
- [ ] Button disabled until both amounts filled; tooltip explains.
- [ ] Client vitest + build green (no regression in FinanceSection).

## 8. Out of scope

- The « blank on reopen » symptom = a save blocked by a booking-conflict/capacity validation
  (discards the edit). Persistence itself works (verified). Improving that blocked-save UX (clearer
  message / allowing finance-only saves on overlapping iCal reservations) is a separate change.
- Auto-computing other platform fields (only the solde commission is deduced, per the request).

## 9. Open questions

- (Resolved 2026-06-24) Auto-fill behaviour → an explicit **« Calculer » button**, never silent
  (operator's choice).
- (Resolved 2026-06-25) « Fields blank on reopen » → not a persistence bug; the platform fields persist
  on a successful save. Root cause = blocked save (validation). Handled separately.
