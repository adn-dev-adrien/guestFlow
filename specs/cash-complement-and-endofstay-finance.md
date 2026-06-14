# « Caisse interne » complement payments (in finance, hors compta) + end-of-stay complement finance parity

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/cash-complement-and-endofstay-finance` _(user-managed)_ |
| **Created** | 2026-06-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A reservation has three payment slots — **acompte**, **solde**, **complément à percevoir**
(`complementAmount`/`complementPaid`/`complementPaidDate`) — plus, since the arrival/departure SAS, a
separate **complément de fin de séjour** (`endOfStayComplementAmount` + `endOfStayComplementDetail`
JSON, e.g. ménage + linge manquant relevés au check-out).

Two gaps:

1. **The end-of-stay complement is financially isolated.** It is stored by `commitDepartureSas` and
   shown on the departure SAS/planning, but it is **not** in the accounting export
   ([accountingModel.js](../server/src/models/accountingModel.js)), **not** in the financial tracking
   ([financeModel.js](../server/src/models/financeModel.js) `getSummary`), **not** on the reservation
   fiche with a « payé » toggle, and `endOfStayComplementPaid` is **never written**. The operator wants
   it handled **exactly like the arrival complement** financially.
2. **No way to record a complement collected in the « caisse interne ».** Some complements are settled
   on site into an **internal cash register** (« caisse interne »). The operator wants to mark such a
   payment so it **counts in the financial tracking** (it IS money collected) **but is excluded from the
   accounting** (compta) **and the accounting export** (decision 2026-06-14, superseding the earlier
   « payé en liquide, hors suivi » framing). This applies to **both** complements.

## 2. Goal

The end-of-stay complement behaves like the arrival complement everywhere (fiche « payé » toggle,
accounting, export, financial tracking). And each complement (arrival + end-of-stay) can be marked
**« caisse interne »**: it then counts as **collected in the financial tracking** (it's real money in)
but is **excluded from the accounting (compta) and the accounting export**.

## 3. Functional rules

### 3.1 End-of-stay complement — finance parity with the arrival complement

1. **Fiche block.** When `endOfStayComplementAmount > 0`, the reservation fiche shows an
   **end-of-stay complement** block mirroring the arrival complement block (amount + « Marquer payé »
   toggle + « Payé le » date), plus a read-only breakdown from `endOfStayComplementDetail`
   (label : amount lines). It is independent from the arrival complement block.
2. **Write path.** A payment toggle persists `endOfStayComplementPaid` (0/1) + `endOfStayComplementPaidDate`
   (defaults to today when flipped on, cleared when off), exactly like `complementPaid`. It must work on
   **past / in-progress** reservations (the end-of-stay complement is collected at check-out, which is
   today or past) — so `endOfStayComplementPaid` / `endOfStayComplementPaidDate` / the cash flag are
   added to the past-reservation **payment allowlist**.
3. **Accounting.** When `endOfStayComplementPaid = 1` (and not cash — rule 3.2), the end-of-stay
   complement is emitted as an encaissement in the month of `endOfStayComplementPaidDate`, as its own
   entry kind **`endOfStayComplement`**, with the same journal structure as the other encaissements
   (client debit + revenue/VAT credits). **VAT = the app general `vatRate`** (the same rate as the stay
   and options — decision 2026-06-14, Q1): the flat TTC amount is split HT + VAT at `vatRate`, booked on
   the standard accommodation revenue + VAT accounts used by the other encaissements.
4. **Financial tracking.** `financeModel.getSummary` includes the end-of-stay complement in
   `collected` (when paid) / `pending` (when due), exactly like the arrival complement.
5. **Export.** The CSV export includes the end-of-stay complement encaissement (it flows from the
   accounting entries of rule 3).
6. **No retro-pricing.** Existing reservations are unaffected until their end-of-stay complement is
   actually set + marked paid; the amount is the one captured by the SAS (not recomputed by the engine).

### 3.2 « Caisse interne » (in financial tracking, excluded from compta) — both complements

7. Each complement (arrival + end-of-stay) gets an independent **caisse-interne flag** —
   `complementPaidCash` / `endOfStayComplementPaidCash` (0/1, default 0).
8. **« Caisse interne » implies paid** (decision 2026-06-14): toggling it ON marks the complement
   **paid** (`…Paid = 1` + paid date = today if unset) **and** sets the flag. The fiche shows it as
   **« Caisse interne »**. Turning the flag OFF on a paid complement leaves it **paid (compta)**;
   marking the complement unpaid clears the flag.
9. **A caisse-interne complement is excluded from the accounting** (`encaissementsByMonth` skips it) —
   no journal entry, nothing in the CSV export.
10. **A caisse-interne complement IS counted in the financial tracking** (`financeModel.getSummary`): it
    is **collected money**, so it adds to `collected` exactly like a normal paid complement. It is only
    kept out of the **compta**.
11. **A caisse-interne complement is visible on the reservation fiche** (its block shows « Caisse
    interne ») and is settled (not shown as « à percevoir » on the planning chip).
12. The flag is **per complement**: a reservation can have its arrival complement in compta and its
    end-of-stay complement in caisse interne, or any combination.

**Edge cases:**
- Marking a complement unpaid clears the caisse-interne flag (an unpaid complement can't be in the
  caisse).
- A complement already paid (compta) → toggling « caisse interne » ON moves it off the accounting
  (removes its journal entry for the month) while **keeping it in the financial tracking**; **its
  existing paid date is preserved** (decision 2026-06-14, Q2).
- `endOfStayComplementAmount = 0` → no end-of-stay block, no toggle (nothing to pay).
- Accounting month already exported (CSV downloaded) before a complement is flipped to/from cash →
  the export is recomputed live each time, so a later flip changes a re-download (no historical lock;
  consistent with how deposit/balance edits already behave).

---

## 4. Architecture

> **Fat backend, thin frontend.** All inclusion/exclusion rules, the cash semantics, and the accounting
> shaping live on the server. The client only renders the two complement blocks + toggles.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: `complementPaidCash INTEGER NOT NULL DEFAULT 0`, `endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0` (the `endOfStayComplementPaid/PaidDate` columns already exist). |
| `controllers/` | `reservationsController.js` | T | `updatePayment`: accept `endOfStayComplementPaid` + `endOfStayComplementPaidDate` (mirror complement) and the two cash flags (cash ON ⇒ also set paid + date; cash OFF ⇒ clear). Add these fields to the past-reservation payment allowlist. |
| `models/` | `accountingModel.js` | T | `encaissementsByMonth`: (a) **exclude** cash complements from the existing `complement` entry (`AND complementPaidCash = 0`); (b) **add** the end-of-stay complement as a new `endOfStayComplement` entry when `endOfStayComplementPaid = 1 AND endOfStayComplementPaidCash = 0 AND endOfStayComplementPaidDate ∈ month`. Select the new columns. |
| `utils/` | `accountingExport.js` | T | Map the new `endOfStayComplement` kind to journal rows (account codes + VAT per §9 Q1). |
| `models/` | `financeModel.js` | T | `getSummary`: add the end-of-stay complement to collected/pending like the arrival complement. **Caisse-interne complements are NOT excluded here** — they count as collected (only the accounting export excludes them). |
| `models/` | `reservationsModel.js` | — | `getByIdWithDetails` already returns `r.*` (new columns flow to the fiche automatically). |
| `models/` | `reservationsModel.js` (`list`) | — | Returns `r.*`, so the planning/finance reads see the new flags with no query change. |

**Notes:** routes stay thin. The cash exclusion is a single `AND …Cash = 0` per aggregation site; the
end-of-stay inclusion mirrors the existing complement paths. The end-of-stay accounting entry is the
only non-trivial addition (§9 Q1).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `FinanceSection.js` | T | Add the **end-of-stay complement block** (amount + parsed detail + « payé » toggle + date), mirroring the arrival complement block. Add a **« Caisse interne »** control to **both** complement blocks. Persists via `api.markPayment` when editing an existing reservation; mirrors into the form. |
| `pages/` | `ReservationPage.js` | T | Load the new fields into the form (`complementPaidCash`, `endOfStayComplement*`) + add them to `EMPTY_FORM`. |
| `components/` | `ReservationCard.js` | — | No change needed: a caisse-interne complement has `complementPaid = 1`, so the existing chip already shows it as « perçu » (not « à percevoir »). |
| `api.js` | `api.js` | — | `markPayment` already forwards an arbitrary payment payload — passes the new fields through. |

**Component reuse declaration:** the end-of-stay block reuses the existing complement-block layout in
`FinanceSection` (extract a small local sub-component if the duplication is non-trivial); no new generic
component.

### 4.3 API contract

| Method | Endpoint | Request body (additive) | Notes |
|---|---|---|---|
| PATCH | `/api/reservations/:id/payment` | `{ endOfStayComplementPaid?, endOfStayComplementPaidDate?, complementPaidCash?, endOfStayComplementPaidCash? }` | All optional; cash ON ⇒ server also sets the matching paid + date. |
| GET | `/api/accounting/sales[.csv]` | — | Excludes cash complements; includes the end-of-stay complement (new `endOfStayComplement` kind). |
| GET | `/api/finance/summary` | — | End-of-stay complement included like the arrival complement; caisse-interne complements **kept** in collected (only the accounting export excludes them). |

`GET /api/reservations/:id` returns the new fields via `r.*` (no shape change beyond the added columns).

---

## 5. Data model

Idempotent `ALTER TABLE` block in `database.js`:

```sql
ALTER TABLE reservations ADD COLUMN complementPaidCash          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0;
```

`endOfStayComplementAmount/Paid/PaidDate/Detail` already exist. The two new flags mean « encaissé en
caisse interne » → kept in the financial tracking, excluded from the compta/export. **Data impact:**
additive; existing rows get cash = 0 (current behaviour: arrival complement in compta, end-of-stay
absent until set + paid). No backfill, no loss.

## 6. UI / UX

- **Reservation fiche ([FinanceSection.js](../client/src/components/reservation/FinanceSection.js)):**
  - The existing **arrival complement** block gains a « Caisse interne » control. When set, the block
    reads « Caisse interne » with a short hint « compté dans le suivi, hors compta ».
  - A new **end-of-stay complement** block (when `endOfStayComplementAmount > 0`): amount, the
    `endOfStayComplementDetail` lines (label : amount), a « Marquer payé » toggle + « Payé le » date,
    and the same « Caisse interne » control.
  - Responsive: same stacked card layout as the existing payment blocks; full-width controls on `xs`.
- **Planning arrival card:** a cash-settled complement is **not** shown as « à percevoir » (it's paid).
- **Accounting / Finance pages:** no UI change — the numbers simply exclude cash complements and now
  include the end-of-stay complement.
- **PageActionBar:** N/A (content inside existing pages).

## 7. Test plan

### Server unit tests (`cd server && npm test` → 1504 green)
- [x] `accounting-encaissements-integration.unit.test.js` (extend) — a caisse-interne arrival complement
      is **absent** from `encaissementsByMonth`; a non-cash one stays. The end-of-stay complement appears
      as an `endOfStayComplement` entry when paid + not cash, split HT+VAT at the app `vatRate` (10%),
      on the « options »/70600010 bucket, no commission/tax; the paid date drives the export month;
      absent when cash or unpaid.
- [x] `finance-model.unit.test.js` (extend) — caisse-interne complement STILL counts as collected (not
      excluded from finance); end-of-stay complement counts as collected (paid) / pending (due); a
      caisse-interne end-of-stay also counts as collected.
- [x] `complement-payment.unit.test.js` (new) — the `resolveComplementPayment` resolver: cash implies
      paid; marking unpaid clears the flag; flipping compta→caisse keeps the existing date; turning the
      flag off keeps it paid (compta); explicit date wins.
- [x] Accounting test fixtures updated for the new columns; full suite green (migration is the existing
      idempotent ADD COLUMN pattern).

### Manual UI verification
- [ ] **Not run live this session** — the dev server is owned by the user. Build green + unit/IHM suites
      cover the logic; a live pass is recommended before release.
- [ ] Fiche: mark the arrival complement « Caisse interne » → block shows « Caisse interne »; it
      disappears from the accounting export but **stays** in the finance summary; still visible on the fiche.
- [ ] Fiche: an end-of-stay complement (from a departure SAS) shows its block + breakdown; mark it paid →
      it appears in accounting + finance like the arrival complement; mark it « Caisse interne » → out of
      compta, kept in finance.
- [ ] Regression: a normally-paid (compta) complement still appears in accounting + finance.

## 8. Out of scope

- Online payment links for the end-of-stay complement (`paymentLinksModel` unchanged).
- Recomputing the end-of-stay complement via the pricing engine (it stays the SAS-captured amount).
- A cash flag on the acompte / solde (only the two complements, per request).
- Per-line VAT breakdown of the end-of-stay complement beyond the §9 Q1 decision.

## 9. Open questions — resolved 2026-06-14

- **Q1 (fiscal) — VAT treatment of the end-of-stay complement.** → **App general `vatRate`** (same rate
  as the stay/options, 10 % by default): split the flat TTC amount HT + VAT at `vatRate`, on the standard
  revenue + VAT accounts. Chosen for parity with how the arrival complement's cleaning/linen is booked.
- **Q2 — flipping an already-compta-paid complement to liquide.** → **Keep the existing paid date**; only
  the cash flag changes.
- **Q3 — fiche wording.** → **« Caisse interne »** (decision 2026-06-14: superseded « Payé en liquide » —
  the payment is kept in the financial tracking, only excluded from the compta; hint « compté dans le
  suivi, hors compta »).
