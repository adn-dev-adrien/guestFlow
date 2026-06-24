# Operational tracking — real « reste à payer » + per-bucket payment state

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/finance-operational-remaining-to-pay` _(user-managed)_ |
| **Created** | 2026-06-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The « Suivi financier » → « Suivi opérationnel » → **Paiements en attente** table
([FinancePage.js](../client/src/pages/FinancePage.js) ~L398-486) shows, per past-unsettled
reservation: Acompte, Solde, **Reste à payer**, Total de séjour. The "Reste à payer" comes from
`computePaymentStatus().remainingDue` ([paymentStatus.js](../server/src/utils/paymentStatus.js)),
which is `finalPrice − (depositPaid ? deposit) − (balancePaid ? balance)` — it **ignores the two
complements** (complément d'arrivée + complément de fin de séjour). So the operational view
disagrees with the reservation fiche ([FinanceSection.js](../client/src/components/reservation/FinanceSection.js)),
which tracks all **four** buckets independently, each with its own paid (and caisse-interne) state.

Concretely: a stay whose deposit + balance are paid but whose complement is still owed shows a
"Reste à payer" that doesn't reflect the complement, and the table has no column for it.

The finance model already has the right primitives:
[financeModel.js](../server/src/models/financeModel.js) `totalSejour(r)` (sum of the 4 buckets,
caisse-interne complements excluded), `comptaCollected(r)` (paid, off-books excluded), and
`isSettled(r)` (every applicable bucket paid / cash / disabled / zero).

## 2. Goal

In the operational « Paiements en attente » view, show the **four** payment buckets — Acompte,
Solde, Complément, Complément de fin de séjour — each coloured **green when settled / red when
still owed**, and a « Reste à payer » equal to the **sum of the still-owed buckets only** (a bucket
already paid — including a caisse-interne complement — is not counted). The numbers then match the
fiche.

## 3. Functional rules

1. The pending table shows, per reservation, four bucket cells in this order: **Acompte**,
   **Solde**, **Complément**, **Complément de fin de séjour**.
2. **Per-bucket colour:**
   - Settled → green. A bucket is settled when: deposit is paid OR disabled OR amount 0; balance
     is paid OR amount 0; a complement is paid OR caisse-interne OR amount 0.
   - Still owed (amount > 0 and not settled) → red.
   - Amount 0 / not applicable → a muted « — » (nothing to collect), not a red/green chip.
   - The deposit keeps its existing « Désactivé » caption when `depositDisabled`.
3. **« Reste à payer » per reservation** = sum of the still-owed buckets only:
   `(!depositDisabled && !depositPaid ? depositAmount : 0) + (!balancePaid ? balanceAmount : 0) +
   (!complementPaid && !complementPaidCash ? complementAmount : 0) + (!endOfStayComplementPaid &&
   !endOfStayComplementPaidCash ? endOfStayComplementAmount : 0)`. Computed **server-side**
   (`remainingToPay`). Equals `0` exactly when the reservation `isSettled`.
4. **Footer + header totals** sum, across the pending list: deposit (non-disabled), balance,
   complément, complément de fin de séjour, **reste à payer** (Σ `remainingToPay`), total de séjour.
   The header chip « En attente de paiement » uses Σ `remainingToPay`.
5. The existing inline paid checkboxes for Acompte and Solde stay; the two complement cells are
   display-only here (marked paid from the fiche or via « Tout solder »). « Tout solder » is
   unchanged (it already settles the four buckets).
6. **No change** to the accounting figures (`comptaCollected`, encaissé, exports) nor to the shared
   `computePaymentStatus.remainingDue` — it still drives the overdue/due-date display elsewhere.

**Edge cases:**
- Caisse-interne complement (`*PaidCash`) → settled (green), excluded from « reste à payer ».
- Disabled deposit → « Désactivé », counts as settled, excluded from the total.
- Fully-settled stay never appears in « Paiements en attente » (filter `!isSettled` unchanged).

---

## 4. Architecture

> **Fat backend.** `remainingToPay` is computed on the server (mirrors `totalSejour` /
> `comptaCollected`); the client only renders the value + colours each bucket from its paid flags.

### 4.1 Server (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `financeModel.js` | T | Add a pure `remainingToPay(r)` helper (sum of still-owed buckets, §3 rule 3); include it on each enriched reservation; add `remainingToPay` + `complementAmount` + `endOfStayComplementAmount` to `pending.totals`. |

No change to `paymentStatus.js`, accounting, or the API route shape (additive fields).

### 4.2 Client (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `FinancePage.js` | T | Pending table: add **Complément** + **Complément de fin de séjour** columns; colour all four bucket cells green/red (muted « — » when 0); « Reste à payer » column + header chip + footer use `remainingToPay`; footer gains the two complement totals. |

**Component reuse:** no new component — reuses the existing table + `Chip`/`Typography` colouring (`success.main` / `error.main`). A small inline `BucketCell` helper inside FinancePage keeps the four cells DRY.

### 4.3 API contract

`GET /api/finance/operational` — additive only: each `pending.reservations[]` gains
`remainingToPay:number` (the four bucket amounts + paid flags are already present);
`pending.totals` gains `remainingToPay`, `complementAmount`, `endOfStayComplementAmount`.

## 5. Data model

No schema change — all four buckets + their paid/cash/disabled flags already exist on `reservations`.

## 6. UI / UX

Pending table columns: Client · Logement · Séjour · Plateforme · **Acompte · Solde · Complément ·
Compl. fin de séjour** · Reste à payer · Total de séjour · Solder.
- Each bucket cell: amount in **green** (`success.main`, settled) or **red** (`error.main`, owed);
  « — » muted when amount 0; deposit shows « Désactivé » when disabled. Acompte/Solde keep their
  paid checkbox + due-date caption.
- « Reste à payer »: red when > 0, green when 0 (unchanged style), value = `remainingToPay`.
- **Responsive:** the table already scrolls horizontally (`minWidth`); bump `minWidth` for the two
  extra columns. Mobile keeps the contained horizontal scroll (no new layout).

## 7. Test plan

### Server unit tests (full suite 1827 pass)
- [x] `finance-model.unit.test.js` — `remainingToPay`: deposit+balance paid but both complements
      owed → counts only the complements (legacy remainingDue would say 0); caisse-interne complement
      + disabled deposit excluded; equals 0 ⟺ settled (drops from pending); pending totals expose
      `remainingToPay` + `complementAmount` + `endOfStayComplementAmount` (4 new tests).

### Manual UI verification (Playwright on the dev server)
- [x] Pending table now shows the 4 bucket columns (Acompte · Solde · Complément · Compl. fin de
      séjour) + Reste à payer + Total de séjour. A reservation with a **caisse-interne** complement
      (80€) renders the Complément cell **green** « 80€ / caisse » and its « Reste à payer » (121,20€)
      **excludes** it — matching the fiche. Server `remainingToPay` verified vs the legacy
      deposit+balance-only value (e.g. disabled-deposit row → balance only).
- [x] E2E smoke suite 28 passed / 1 skipped.

## 8. Out of scope

- Per-complement paid toggles in the operational table (done from the fiche / « Tout solder »).
- Changing `computePaymentStatus.remainingDue` or any accounting/export figure.
- The « overdue » and « upcoming » sub-views (only « Paiements en attente » changes).

## 9. Open questions

- (Resolved 2026-06-24) « Reste à payer » = sum of **still-owed** buckets (paid ones, incl.
  caisse-interne, are not counted); all four buckets shown green/red.
